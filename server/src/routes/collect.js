const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { routeToAdapter } = require('../services/collector');
const { extractContent } = require('../services/extractor');
const { normalizeShareUrl } = require('../services/url-utils');
const { filterItems } = require('../services/filter');
const { classifyItems } = require('../services/classifier');
const { classifyByAI, isAIAvailable } = require('../services/classifier-ai');
const { batchUpsert, computeContentHash } = require('../services/knowledge');
const { generateEntryMd, updateIndex, appendLog } = require('../services/fs-wiki');
const { run } = require('../db');

const router = Router();

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'data', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function logCollect(platform, itemCount, validCount, status) {
  run(
    'INSERT INTO collect_logs (source_platform, item_count, valid_count, status) VALUES (?, ?, ?, ?)',
    [platform, itemCount, validCount, status]
  );
}

/**
 * 对单条 item 跑完整流程：提取 -> 过滤 -> 分类
 * 返回处理后的 item（含 AI 生成的分类/摘要/标签）
 *
 * 提取阶段按平台内容类型分治：
 *  - 微信公众号（图文）-> HTTP 抓正文（extractArticle）
 *  - B站/抖音/小红书（视频）-> yt-dlp 提取标题+字幕
 *  - 抖音短链/口令先经 normalizeShareUrl 展开为真实 URL
 */
async function processItem(item) {
  // 0. 短链 / 分享口令解析（抖音等）
  let resolvedUrl = item.url || '';
  if (resolvedUrl) {
    try {
      resolvedUrl = await normalizeShareUrl(resolvedUrl);
    } catch (err) {
      console.error(`[url] ${item.url} 解析失败:`, err.message);
    }
  }

  // 1. 按平台类型提取（视频走 yt-dlp，图文走 HTTP 抓正文）
  let extracted = { title: '', author: '', description: '', contentText: '', sourceType: 'none' };
  try {
    if (resolvedUrl) {
      extracted = await extractContent(resolvedUrl, item.source_platform);
    }
  } catch (err) {
    console.error(`[extract] ${resolvedUrl} 提取失败:`, err.message);
  }

  // 用提取到的信息补全（用户未填的用提取结果）
  const contentText = extracted.contentText || '';
  const enriched = {
    ...item,
    url: resolvedUrl || item.url || '',
    title: item.title || extracted.title || '',
    source_author: item.source_author || extracted.author || '',
    summary: item.summary || extracted.description || '',
    contentText,
    content_hash: computeContentHash(contentText, item.title || extracted.title || ''),
    collected_at: new Date().toISOString(),
  };

  // 2. 过滤引擎（exclude 规则，基于标题+简介）
  const searchText = (enriched.title + ' ' + enriched.summary).toLowerCase();
  const { all } = require('../db');
  const excludeRules = all('SELECT * FROM category_rules WHERE rule_type = ? AND enabled = 1', ['exclude']);
  for (const rule of excludeRules) {
    if (rule.pattern && searchText.includes(rule.pattern.toLowerCase())) {
      return {
        ...enriched,
        is_valid: 0,
        filter_reason: `命中排除规则: ${rule.pattern}`,
        category_l1: '', category_l2: '', category_l3: '',
        tags: [], summary: enriched.summary,
        ai_source: 'rule_filter',
        ai_confidence: 'high',
      };
    }
  }

  // 3. 分类：优先 AI，失败/未配置则降级关键词分类器
  if (isAIAvailable()) {
    try {
      const aiResult = await classifyByAI({
        title: enriched.title,
        author: enriched.source_author,
        description: enriched.summary,
        contentText: enriched.contentText,
        platform: enriched.source_platform,
      });
      console.log('[ai] 返回:', JSON.stringify(aiResult));
      return {
        ...enriched,
        ...aiResult,
        content_text: enriched.contentText,
        content_hash: enriched.content_hash,
        // AI 摘要覆盖原 summary（更精炼）
        summary: aiResult.summary || enriched.summary,
        tags: aiResult.tags,
      };
    } catch (err) {
      console.error(`[ai] ${enriched.title} AI 分类失败，降级关键词:`, err.message);
    }
  }

  // 降级：关键词分类器（只分类，不生成摘要）
  const [keywordClassified] = classifyItems([enriched]);
  return {
    ...keywordClassified,
    content_text: enriched.contentText,
    content_hash: enriched.content_hash,
    summary: enriched.summary,
    ai_source: 'keyword_fallback',
    ai_confidence: 'low',
  };
}

/**
 * 为新增的有效条目生成 .md 文件到 kb-wiki/raw/articles/
 * 过滤的条目（is_valid=0）不生成
 */
function generateMdForEntries(insertedItems) {
  let generated = 0;
  for (const item of insertedItems) {
    if (item.is_valid === 0) continue;
    try {
      const result = generateEntryMd(item);
      generated++;
      // 回填 md_path 到数据库，便于后续重新提取时覆盖而非重复生成
      if (result.path && item.id) {
        try {
          run('UPDATE knowledge_entries SET md_path = ? WHERE id = ?', [result.path, item.id]);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error(`[wiki] 生成 .md 失败 ${item.title}:`, err.message);
    }
  }
  if (generated > 0) {
    try {
      updateIndex();
      appendLog('import', `${generated} files`);
    } catch (err) {
      console.error('[wiki] 更新索引失败:', err.message);
    }
  }
  return generated;
}

/**
 * POST /api/collect/import
 * 手动导入链接列表
 * Body: { platform, items: [{title, url, author?, description?}] }
 */
router.post('/import', async (req, res, next) => {
  try {
    const { platform, items: rawItems } = req.body;

    if (!platform || !rawItems || !Array.isArray(rawItems)) {
      return res.status(400).json({ success: false, error: '缺少 platform 或 items 参数' });
    }

    const input = { links: rawItems };
    const items = routeToAdapter(platform, input);

    // 串行处理（避免 yt-dlp 并发被风控）
    const processedItems = [];
    const failedItems = [];
    for (const item of items) {
      try {
        const processed = await processItem(item);
        processedItems.push(processed);
      } catch (err) {
        console.error(`[collect] 处理失败 ${item.url}:`, err.message);
        failedItems.push({ ...item, is_valid: 1, filter_reason: `处理失败: ${err.message}` });
      }
    }

    const allItems = [...processedItems, ...failedItems];
    const result = batchUpsert(allItems);

    // 为新增有效条目生成 .md
    const mdGenerated = generateMdForEntries(result.insertedItems);

    const validCount = processedItems.filter((i) => i.is_valid === 1).length;
    logCollect(platform, rawItems.length, validCount, 'done');

    res.json({
      success: true,
      data: {
        total: rawItems.length,
        valid: validCount,
        filtered: rawItems.length - validCount,
        inserted: result.inserted,
        skipped: result.skipped,
        aiEnabled: isAIAvailable(),
        mdGenerated,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/collect/import/file
 * 文件批量导入 (CSV/JSON)
 */
router.post('/import/file', upload.single('file'), async (req, res, next) => {
  let filePath = null;
  try {
    const { platform } = req.body;
    const file = req.file;

    if (!file || !platform) {
      if (file) {
        filePath = file.path;
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({ success: false, error: '缺少 file 或 platform 参数' });
    }
    filePath = file.path;

    const content = fs.readFileSync(file.path, 'utf-8');
    const ext = path.extname(file.originalname).toLowerCase();

    let parsedData = [];
    if (ext === '.json') {
      parsedData = JSON.parse(content);
      if (!Array.isArray(parsedData)) parsedData = [parsedData];
    } else if (ext === '.csv') {
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        return res.status(400).json({ success: false, error: 'CSV 文件至少需要表头 + 一行数据' });
      }
      const headers = lines[0].split(',').map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
        parsedData.push(row);
      }
    } else {
      return res.status(400).json({ success: false, error: '不支持的文件格式，请上传 JSON 或 CSV' });
    }

    const input = { csvData: parsedData };
    const items = routeToAdapter(platform, input);

    const processedItems = [];
    for (const item of items) {
      try {
        const processed = await processItem(item);
        processedItems.push(processed);
      } catch (err) {
        processedItems.push({ ...item, is_valid: 1, filter_reason: `处理失败: ${err.message}` });
      }
    }

    const result = batchUpsert(processedItems);
    const mdGenerated = generateMdForEntries(result.insertedItems);
    const validCount = processedItems.filter((i) => i.is_valid === 1).length;
    logCollect(platform, parsedData.length, validCount, 'done');

    res.json({
      success: true,
      data: {
        total: parsedData.length,
        valid: validCount,
        filtered: parsedData.length - validCount,
        inserted: result.inserted,
        skipped: result.skipped,
        aiEnabled: isAIAvailable(),
        mdGenerated,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
});

module.exports = router;
