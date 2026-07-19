/**
 * 重新提取服务
 *
 * 对已入库的条目重新跑：提取正文 + AI 分类（含 description）+ 更新数据库 + 覆盖 .md
 *
 * 解决历史数据正文为空（阶段一导入时未存 content_text）的问题，
 * 并为每个条目生成 description 字段（供未来问答助手渐进式检索）。
 *
 * 流程：读条目 -> extractContent -> classifyByAI -> 更新库 -> generateEntryMd(覆盖) -> updateIndex
 */

const { get, all, run } = require('../db');
const { extractContent } = require('./extractor');
const { classifyByAI, isAIAvailable } = require('./classifier-ai');
const { generateEntryMd, updateIndex, appendLog } = require('./fs-wiki');
const { computeContentHash } = require('./knowledge');

/**
 * 重新提取单条条目
 * @param {number} id
 * @returns {Promise<{id, title, contentLen, description, mdPath, aiSource, error?}>}
 */
async function reextractEntry(id) {
  const entry = get('SELECT * FROM knowledge_entries WHERE id = ?', [id]);
  if (!entry) {
    return { id, error: '条目不存在' };
  }

  const result = { id, title: entry.title, contentLen: 0, description: '', mdPath: '', aiSource: '' };

  // 1. 重新提取正文
  let extracted = { contentText: '', title: '', author: '', description: '' };
  try {
    if (entry.url) {
      extracted = await extractContent(entry.url, entry.source_platform);
    }
  } catch (err) {
    console.error(`[reextract] 提取失败 ${entry.title}:`, err.message);
  }

  const contentText = extracted.contentText || '';
  result.contentLen = contentText.length;

  // 2. AI 重新分类（生成 description + 分类 + 摘要 + 标签）
  let aiResult = null;
  if (isAIAvailable()) {
    try {
      aiResult = await classifyByAI({
        title: entry.title,
        author: entry.source_author,
        description: extracted.description || entry.summary,
        contentText,
        platform: entry.source_platform,
      });
      result.description = aiResult.description || '';
      result.aiSource = aiResult.ai_source || '';
    } catch (err) {
      console.error(`[reextract] AI 分类失败 ${entry.title}:`, err.message);
    }
  }

  // 3. 更新数据库
  const contentHash = computeContentHash(contentText, entry.title);
  const updated = {
    content_text: contentText,
    content_hash: contentHash,
    description: aiResult?.description || '',
    category_l1: aiResult?.category_l1 ?? entry.category_l1,
    category_l2: aiResult?.category_l2 ?? entry.category_l2,
    category_l3: aiResult?.category_l3 ?? entry.category_l3,
    summary: aiResult?.summary || entry.summary,
    tags: aiResult?.tags ? JSON.stringify(aiResult.tags) : entry.tags,
    is_valid: aiResult?.is_valid != null ? aiResult.is_valid : entry.is_valid,
    filter_reason: aiResult?.filter_reason ?? entry.filter_reason,
    ai_source: aiResult?.ai_source || '',
    ai_confidence: aiResult?.ai_confidence || '',
  };

  run(
    `UPDATE knowledge_entries
     SET content_text = ?, content_hash = ?, description = ?,
         category_l1 = ?, category_l2 = ?, category_l3 = ?,
         summary = ?, tags = ?, is_valid = ?, filter_reason = ?,
         ai_source = ?, ai_confidence = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      updated.content_text,
      updated.content_hash,
      updated.description,
      updated.category_l1,
      updated.category_l2,
      updated.category_l3,
      updated.summary,
      updated.tags,
      updated.is_valid,
      updated.filter_reason,
      updated.ai_source,
      updated.ai_confidence,
      id,
    ]
  );

  // 4. 重新生成 .md（覆盖 md_path 指向的文件，或新建）
  if (updated.is_valid === 1) {
    try {
      const mdResult = generateEntryMd({ ...entry, ...updated, md_path: entry.md_path });
      result.mdPath = mdResult.path;
      // 回填 md_path（新建时）
      if (!entry.md_path && mdResult.path) {
        run('UPDATE knowledge_entries SET md_path = ? WHERE id = ?', [mdResult.path, id]);
      }
    } catch (err) {
      console.error(`[reextract] 生成 .md 失败 ${entry.title}:`, err.message);
    }
  }

  return result;
}

/**
 * 重新提取全部条目
 * @param {object} opts - { onlyEmpty: boolean } true=只处理正文为空的
 * @param {function} onProgress - 每条完成回调 (index, total, result)
 * @returns {Promise<{processed: number, ok: number, failed: number}>}
 */
async function reextractAll({ onlyEmpty = false } = {}, onProgress) {
  let sql = 'SELECT id FROM knowledge_entries';
  const params = [];
  if (onlyEmpty) {
    // 只处理正文为空 或 description 为空的（缺正文或缺检索描述的）
    sql += ' WHERE content_text IS NULL OR content_text = ? OR description IS NULL OR description = ?';
    params.push('', '');
  }
  sql += ' ORDER BY id ASC';

  const ids = all(sql, params).map((r) => r.id);
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i++) {
    try {
      const r = await reextractEntry(ids[i]);
      if (r.error) {
        failed++;
      } else {
        ok++;
      }
      if (onProgress) onProgress(i + 1, ids.length, r);
    } catch (err) {
      console.error(`[reextract] 条目 ${ids[i]} 失败:`, err.message);
      failed++;
      if (onProgress) onProgress(i + 1, ids.length, { id: ids[i], error: err.message });
    }
  }

  try {
    updateIndex();
    appendLog('reextract', `${ok} entries`);
  } catch { /* ignore */ }

  return { processed: ids.length, ok, failed };
}

module.exports = { reextractEntry, reextractAll };
