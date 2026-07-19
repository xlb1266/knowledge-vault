/**
 * Wiki 蒸馏引擎（raw -> 交叉链接知识页）
 *
 * 遵循 AGENTS.md 的 distill 规则（借鉴 Obsidian/Karpathy LLM-wiki 方法论）：
 *   - 不是 1:1 搬运：多条 raw 汇聚成一个概念/主题页
 *   - 交叉链接：wiki 页正文用 [[概念名]] 标记，指向其他 wiki 页标题
 *   - 保留 description：供问答助手渐进式检索预筛
 *
 * 流程：
 *   1. 拉所有有效 raw 条目
 *   2. [规划] AI 看所有条目元信息 -> 产出 wiki 页清单（type/title/source_ids/related）
 *   3. 清空 AI 旧页（frontmatter ai_generated=true 的，保留手动页）
 *   4. [合成] 对每个页：取 source_ids 正文 -> AI 合成蒸馏正文 + description
 *   5. [lint] 检查 [[link]] 是否全部命中页标题，断链记 log
 *   6. updateIndex + appendLog
 */

const fs = require('fs');
const path = require('path');
const { all, get } = require('../db');
const { getClient, isAIAvailable, MODEL } = require('./ai-client');
const {
  KB_ROOT,
  assertSafePath,
  makeFilename,
  appendLog,
  updateIndex,
} = require('./fs-wiki');

const WIKI_TYPES = ['entities', 'concepts', 'topics', 'comparisons', 'overviews'];
const TYPE_DEFAULT = 'topics';
const MAX_PER_SOURCE = 3000; // 单条 raw 正文截断
const MAX_SOURCES_PER_PAGE = 4; // 单个 wiki 页最多引用的 raw 条目

/**
 * 蒸馏全部：raw -> wiki 交叉链接知识页
 * @param {function} onProgress - (stage, payload) 进度回调
 * @returns {Promise<{pagesGenerated:number, links:number, brokenLinks:string[], error?:string}>}
 */
async function distillAll(onProgress) {
  if (!isAIAvailable()) {
    return { error: 'AI 未配置（缺 SILICONFLOW_API_KEY 或为占位符），无法蒸馏', pagesGenerated: 0, links: 0, brokenLinks: [] };
  }

  // 1. 拉所有有效条目
  const entries = all(
    `SELECT id, title, description, summary, content_text, source_platform,
            category_l1, category_l2, category_l3, tags
     FROM knowledge_entries
     WHERE is_valid = 1 AND description != ''
     ORDER BY id ASC`
  );

  if (!entries.length) {
    return { error: '知识库暂无可蒸馏内容（需要有效条目且带 description）', pagesGenerated: 0, links: 0, brokenLinks: [] };
  }

  // 2. 规划 wiki 页清单
  if (onProgress) onProgress('plan', { total: entries.length });
  const manifest = await planWikiPages(entries);
  if (!manifest.length) {
    return { error: 'AI 规划未产出任何 wiki 页', pagesGenerated: 0, links: 0, brokenLinks: [] };
  }

  // 规范化：type 合法化、related 只保留清单内标题、source_ids 去重
  const titleSet = new Set(manifest.map((p) => p.title));
  const cleanManifest = manifest
    .filter((p) => p && p.title && String(p.title).trim())
    .map((p) => ({
      type: WIKI_TYPES.includes(p.type) ? p.type : TYPE_DEFAULT,
      title: String(p.title).trim(),
      source_ids: Array.isArray(p.source_ids)
        ? [...new Set(p.source_ids.map(Number).filter((n) => !isNaN(n)))]
        : [],
      related: Array.isArray(p.related)
        ? p.related.map((s) => String(s).trim()).filter((s) => titleSet.has(s))
        : [],
      purpose: p.purpose || '',
    }));

  // 3. 清空 AI 旧页（保留手动页）
  const removed = clearAIPages();

  // 4. 合成每个页
  const written = [];
  for (let i = 0; i < cleanManifest.length; i++) {
    const page = cleanManifest[i];
    if (onProgress) onProgress('synthesize', { index: i + 1, total: cleanManifest.length, title: page.title });
    try {
      const sourceEntries = (page.source_ids.length ? page.source_ids : [])
        .map((id) => entries.find((e) => e.id === id))
        .filter(Boolean)
        .slice(0, MAX_SOURCES_PER_PAGE);
      // 若规划没给出 source_ids，兜底用所有条目（库小）
      const sources = sourceEntries.length ? sourceEntries : entries.slice(0, MAX_SOURCES_PER_PAGE);
      const result = await synthesizePage(page, sources, [...titleSet]);
      // 清除断链：把不在标题集的 [[x]] 降级为纯文本 x，保证 wiki 无悬空链接
      const safeContent = sanitizeLinks(result.content, titleSet);
      writeWikiPage(page, safeContent, result.description);
      written.push({ ...page, content: safeContent });
    } catch (err) {
      console.error(`[distill] 合成失败 ${page.title}:`, err.message);
    }
  }

  // 5. lint 断链
  const { links, brokenLinks } = lintLinks(written, titleSet);
  if (brokenLinks.length) {
    appendLog('lint-warn', `${brokenLinks.length} broken links: ${brokenLinks.slice(0, 5).join(', ')}`);
  }

  // 6. 索引 + 日志
  try {
    updateIndex();
    appendLog('distill', `${written.length} wiki pages (removed ${removed} old)`);
  } catch { /* ignore */ }

  return { pagesGenerated: written.length, links, brokenLinks };
}

/**
 * 阶段1：规划 wiki 页清单
 */
async function planWikiPages(entries) {
  const openai = getClient();
  const list = entries
    .map(
      (e) =>
        `[#${e.id}] ${e.title} | 分类：${[e.category_l1, e.category_l2, e.category_l3].filter(Boolean).join('/') || '未分类'} | 标签：${safeParseTags(e.tags).join(',')} | 描述：${e.description}`
    )
    .join('\n');

  const systemPrompt = `你是知识库蒸馏引擎。下面是 raw 层所有条目（编号、标题、分类、标签、检索描述）。
请规划 wiki 层知识页清单，遵循 Obsidian/Karpathy LLM-wiki 方法论：

1. 从多条 raw 提炼共性概念/实体/主题，不要 1:1 搬运（多条同主题应汇聚成一页）
2. 独立但重要的主题也单独成页
3. 每页指定 type：concept（技术概念/术语）、entity（人物/工具/项目/组织）、topic（主题综合）、comparison（对比分析）、overview（高层概览）
4. source_ids：引用相关 raw 条目编号（数组）
5. related：用标题字符串数组标注关联页，且【只能引用本次清单中将出现的标题】（保证无断链）
6. purpose：一句话说明这页要讲什么

只返回 JSON 数组，不要解释：
[{"type":"concept","title":"LangChain","source_ids":[3,7],"related":["LangGraph","RAG"],"purpose":"LangChain 框架核心概念与用法"}]

条目清单：
${list}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请规划 wiki 页清单。' },
    ],
    temperature: 0.4,
    max_tokens: 2000,
    enable_thinking: false,
  });

  const text = completion.choices[0]?.message?.content || '';
  return parseJsonArray(text);
}

/**
 * 阶段2：合成单个 wiki 页（蒸馏正文 + description）
 */
async function synthesizePage(page, sourceEntries, allTitles) {
  const openai = getClient();
  const sources = sourceEntries
    .map(
      (e) =>
        `[#${e.id}] ${e.title}\n来源：${e.source_platform}\n正文：${(e.content_text || '').slice(0, MAX_PER_SOURCE)}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `你是知识库蒸馏引擎。为 wiki 知识页「${page.title}」（类型 ${page.type}）合成蒸馏内容。
参考资料（raw 条目）：
${sources}

要求：
1. 综合提炼结构化知识，不是搬运原文；用 markdown 组织（## 小标题 / 列表）
2. 文中涉及其他知识点用 [[概念名]] 标记交叉链接，且【只能使用以下已有标题】：${allTitles.join('、')}
3. 生成 description（主题 + 3-6 个关键词 + 适用查询场景，50-100 字，供问答助手检索预筛）
4. 正文开头用 # ${page.title} 作为标题

只返回 JSON，不要解释：
{"content":"# ${page.title}\\n\\n蒸馏正文...","description":"主题+关键词+适用场景"}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: page.purpose ? `本页目的：${page.purpose}` : '请合成。' },
    ],
    temperature: 0.4,
    max_tokens: 1500,
    enable_thinking: false,
  });

  const text = completion.choices[0]?.message?.content || '';
  const parsed = parseJsonObject(text);
  return {
    content: parsed.content || `# ${page.title}\n\n（蒸馏内容生成失败）`,
    description: parsed.description || '',
  };
}

// ============ 文件写入 / 清理 ============

/**
 * 写一个 wiki 页到 wiki/{type}/{清理后标题}.md
 */
function writeWikiPage(page, content, description) {
  const filename = makeFilename(page.title);
  const relPath = `wiki/${page.type}/${filename}`;
  const abs = assertSafePath(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const fm = [
    '---',
    `type: ${page.type}`,
    `title: ${yamlScalar(page.title)}`,
    description ? `description: ${yamlScalar(description)}` : null,
    page.source_ids.length ? `source_ids: [${page.source_ids.join(', ')}]` : null,
    page.related.length ? `related: [${page.related.map((s) => JSON.stringify(s)).join(', ')}]` : null,
    'ai_generated: true',
    `distilled_at: ${new Date().toISOString()}`,
    '---',
    '',
  ].filter((l) => l !== null).join('\n');

  fs.writeFileSync(abs, `${fm}\n${content}\n`, 'utf-8');
}

/**
 * 清空 wiki/{五类}/ 下所有 ai_generated=true 的 .md，保留手动页
 * @returns {number} 删除数量
 */
function clearAIPages() {
  let removed = 0;
  for (const type of WIKI_TYPES) {
    const dir = path.join(KB_ROOT, 'wiki', type);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const abs = path.join(dir, f);
      try {
        const content = fs.readFileSync(abs, 'utf-8');
        const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const isAI = m && /ai_generated:\s*true/m.test(m[1]);
        if (isAI) {
          fs.unlinkSync(abs);
          removed++;
        }
      } catch { /* ignore single file */ }
    }
  }
  return removed;
}

// ============ lint 断链检查 ============

/**
 * 扫描所有 wiki 页正文中的 [[link]]，检查能否命中页标题集合
 */
function lintLinks(pages, titleSet) {
  let links = 0;
  const brokenLinks = [];
  const seen = new Set();
  for (const page of pages) {
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(page.content)) !== null) {
      const target = m[1].trim();
      links++;
      if (!titleSet.has(target) && !seen.has(target)) {
        brokenLinks.push(target);
        seen.add(target);
      }
    }
  }
  return { links, brokenLinks };
}

// ============ 工具函数 ============

/**
 * 把不在标题集合中的 [[x]] 降级为纯文本 x，消除悬空链接
 * （AI 合成时可能用了不在清单内的标题，这里兜底清洗）
 */
function sanitizeLinks(content, titleSet) {
  return content.replace(/\[\[([^\]]+)\]\]/g, (full, target) => {
    const t = target.trim();
    return titleSet.has(t) ? full : t;
  });
}

function safeParseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const p = JSON.parse(tags);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function yamlScalar(s) {
  // 含特殊字符的值加引号（与 fs-wiki.yamlEscape 一致策略）
  if (!s) return s;
  if (/[:\[\]{}&,*#?|<>%@`"'\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function parseJsonArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseJsonObject(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}

module.exports = { distillAll };
