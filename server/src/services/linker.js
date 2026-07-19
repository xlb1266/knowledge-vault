const { all } = require('../db');

/**
 * 交叉链接服务：为某条目找相关收藏
 *
 * 评分规则（借鉴 obsidian-wiki 的 wikilinks 理念，但实时计算不预存）：
 *  - 同 l1 + 同 l2：+5 分（同子领域）
 *  - 同 l1 但不同 l2：+2 分（同大领域）
 *  - 每个共同 tag：+1 分
 *  - 同平台：+0.5 分（轻微加权，同平台内容更可能相关）
 *
 * 不用预存 related_ids 字段：分类/标签会变，预存需要同步更新，实时计算更准且简单。
 * 数据量小时全表扫足够（个人知识库规模），后续量大可加索引或缓存。
 */

const RELATED_LIMIT = 6;

/**
 * 找出与指定条目最相关的若干条目
 * @param {number} entryId
 * @param {number} limit
 * @returns {Array} 相关条目（不含正文，轻量）
 */
function findRelated(entryId, limit = RELATED_LIMIT) {
  const target = all('SELECT * FROM knowledge_entries WHERE id = ? AND is_valid = 1', [entryId]);
  if (!target || target.length === 0) return [];

  const entry = parseTags(target[0]);
  if (!entry.category_l1) return []; // 无分类无法关联

  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const tagSet = new Set(tags.map((t) => String(t).toLowerCase()));

  // 候选：同 l1 且非自身的有效条目
  const candidates = all(
    `SELECT * FROM knowledge_entries
     WHERE id != ? AND is_valid = 1 AND category_l1 = ?
     ORDER BY created_at DESC LIMIT 200`,
    [entryId, entry.category_l1]
  );

  const scored = candidates
    .map((row) => {
      const c = parseTags(row);
      let score = 0;

      if (c.category_l2 === entry.category_l2 && entry.category_l2) {
        score += 5;
      } else {
        score += 2;
      }

      const cTags = Array.isArray(c.tags) ? c.tags : [];
      const common = cTags.filter((t) => tagSet.has(String(t).toLowerCase()));
      score += common.length;

      if (c.source_platform === entry.source_platform) score += 0.5;

      return { ...c, _score: score, _commonTags: common };
    })
    .filter((c) => c._score > 2) // 至少同大领域才有意义
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  // 剥离内部评分字段，返回轻量数据
  return scored.map(({ _score, _commonTags, content_text, ...rest }) => ({
    ...rest,
    relevanceScore: _score,
    commonTags: _commonTags,
  }));
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

module.exports = { findRelated };
