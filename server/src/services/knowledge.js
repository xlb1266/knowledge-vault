const { run, all, get } = require('../db');
const { findRelated } = require('./linker');

/**
 * 计算内容指纹：正文前 2000 字的简单哈希
 * 用于跨 URL 去重（同一内容不同链接 / 重新采集）
 */
function computeContentHash(contentText, title) {
  const crypto = require('crypto');
  const base = (contentText || '').slice(0, 2000) + '|' + (title || '');
  if (!base.trim() || base === '|') return '';
  return crypto.createHash('md5').update(base).digest('hex');
}

/**
 * 批量保存知识条目（含 URL 去重 + 内容指纹去重）
 * 去重优先级：同 URL+平台 > 同内容指纹（跨 URL 同内容）
 * @param {Array} items - 条目数组
 * @returns {{inserted: number, skipped: number, insertedItems: Array}} insertedItems 含完整入库数据，供生成 .md 用
 */
function batchUpsert(items) {
  let inserted = 0;
  let skipped = 0;
  const insertedItems = [];

  for (const item of items) {
    // 1. URL + 平台去重
    if (item.url) {
      const existing = get(
        'SELECT id FROM knowledge_entries WHERE url = ? AND source_platform = ?',
        [item.url, item.source_platform]
      );
      if (existing) {
        skipped++;
        continue;
      }
    }

    // 2. 内容指纹去重（跨 URL 同内容：如重新采集、不同分享链接指向同一文章）
    const contentHash = item.content_hash || computeContentHash(item.content_text, item.title);
    if (contentHash) {
      const dup = get(
        'SELECT id FROM knowledge_entries WHERE content_hash = ? AND content_hash != ?',
        [contentHash, '']
      );
      if (dup) {
        skipped++;
        continue;
      }
    }

    const result = run(
      `INSERT INTO knowledge_entries
        (title, url, source_platform, source_author, summary, category_l1, category_l2, category_l3, tags, is_valid, filter_reason, collected_at, content_text, content_hash, ai_source, ai_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.title || '',
        item.url || '',
        item.source_platform || '',
        item.source_author || '',
        item.summary || '',
        item.category_l1 || '',
        item.category_l2 || '',
        item.category_l3 || '',
        JSON.stringify(item.tags || []),
        item.is_valid != null ? item.is_valid : 1,
        item.filter_reason || '',
        item.collected_at || new Date().toISOString(),
        item.content_text || '',
        contentHash,
        item.ai_source || '',
        item.ai_confidence || '',
      ]
    );
    inserted++;
    // 收集入库后的完整数据（带生成的 id），供生成 .md
    insertedItems.push({
      ...item,
      id: result.lastInsertRowid,
      content_text: item.content_text || item.contentText || '',
      content_hash: contentHash,
    });
  }

  return { inserted, skipped, insertedItems };
}

/**
 * 分页查询知识条目
 * @param {object} opts
 * @param {boolean} opts.searchFull - true 时搜索范围扩展到正文 content_text（全文检索，较慢）
 */
function getEntries({ page = 1, pageSize = 20, l1, l2, platform, search, valid, searchFull } = {}) {
  const conditions = [];
  const params = [];

  if (l1) {
    conditions.push('category_l1 = ?');
    params.push(l1);
  }
  if (l2) {
    conditions.push('category_l2 = ?');
    params.push(l2);
  }
  if (platform) {
    conditions.push('source_platform = ?');
    params.push(platform);
  }
  if (search) {
    // 默认分层检索：标题 + 摘要（快，命中率高）
    // searchFull=1 扩展到正文（全文检索，数据量大时较慢）
    if (searchFull) {
      conditions.push('(title LIKE ? OR summary LIKE ? OR content_text LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      conditions.push('(title LIKE ? OR summary LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
  }
  if (valid !== undefined && valid !== '' && valid !== null) {
    conditions.push('is_valid = ?');
    params.push(Number(valid));
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * pageSize;

  const countRow = get(`SELECT COUNT(*) as total FROM knowledge_entries ${where}`, params);
  const rows = all(
    `SELECT * FROM knowledge_entries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    items: rows.map(parseTags),
    total: countRow?.total || 0,
    page,
    pageSize,
    totalPages: Math.ceil((countRow?.total || 0) / pageSize),
  };
}

/**
 * 获取单条条目
 */
function getEntry(id) {
  const row = get('SELECT * FROM knowledge_entries WHERE id = ?', [id]);
  return row ? parseTags(row) : null;
}

/**
 * 拉取所有有效条目（含 content_text，供 wiki regenerate 用）
 * 不分页，按 id 升序
 */
function getAllEntriesForWiki() {
  const rows = all('SELECT * FROM knowledge_entries ORDER BY id ASC');
  return rows.map(parseTags);
}

/**
 * 更新单条条目
 */
function updateEntry(id, data) {
  const allowed = ['title', 'summary', 'category_l1', 'category_l2', 'category_l3', 'tags', 'is_valid', 'source_author'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(key === 'tags' ? JSON.stringify(data[key]) : data[key]);
    }
  }

  if (sets.length === 0) return getEntry(id);

  sets.push("updated_at = datetime('now')");
  params.push(id);
  run(`UPDATE knowledge_entries SET ${sets.join(', ')} WHERE id = ?`, params);
  return getEntry(id);
}

/**
 * 删除单条条目
 */
function deleteEntry(id) {
  const result = run('DELETE FROM knowledge_entries WHERE id = ?', [id]);
  return { changes: result.changes };
}

/**
 * 批量操作
 */
function batchOperation(ids, action) {
  if (!ids || ids.length === 0) return { affected: 0 };

  const placeholders = ids.map(() => '?').join(',');

  if (action === 'delete') {
    run(`DELETE FROM knowledge_entries WHERE id IN (${placeholders})`, ids);
    return { affected: ids.length };
  }

  if (action === 'mark_valid') {
    run(`UPDATE knowledge_entries SET is_valid = 1, updated_at = datetime('now') WHERE id IN (${placeholders})`, ids);
    return { affected: ids.length };
  }

  if (action === 'mark_invalid') {
    run(`UPDATE knowledge_entries SET is_valid = 0, updated_at = datetime('now') WHERE id IN (${placeholders})`, ids);
    return { affected: ids.length };
  }

  throw new Error(`不支持的批量操作: ${action}`);
}

/**
 * 获取统计信息
 */
function getStats() {
  const total = get('SELECT COUNT(*) as count FROM knowledge_entries').count;
  const valid = get('SELECT COUNT(*) as count FROM knowledge_entries WHERE is_valid = 1').count;
  const filtered = get('SELECT COUNT(*) as count FROM knowledge_entries WHERE is_valid = 0').count;

  const byPlatform = all(
    'SELECT source_platform, COUNT(*) as count FROM knowledge_entries GROUP BY source_platform'
  );

  const byCategory = all(
    'SELECT category_l1, category_l2, COUNT(*) as count FROM knowledge_entries WHERE is_valid = 1 GROUP BY category_l1, category_l2 ORDER BY count DESC'
  );

  return { total, valid, filtered, byPlatform, byCategory };
}

/**
 * 获取已过滤条目
 */
function getFilteredEntries({ page = 1, pageSize = 20 } = {}) {
  return getEntries({ page, pageSize, valid: 0 });
}

function parseTags(row) {
  if (row && row.tags && typeof row.tags === 'string') {
    try {
      row.tags = JSON.parse(row.tags);
    } catch {
      row.tags = [];
    }
  }
  return row;
}

module.exports = {
  batchUpsert,
  getEntries,
  getEntry,
  getAllEntriesForWiki,
  updateEntry,
  deleteEntry,
  batchOperation,
  getStats,
  getFilteredEntries,
  findRelated,
  computeContentHash,
};
