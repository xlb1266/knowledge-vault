const { all } = require('../db');

/**
 * 过滤引擎：根据规则库决定内容是否有效
 * 规则优先级：exclude > include（exclude 命中直接丢弃）
 * @param {Array} items - 待过滤条目数组
 * @returns {{ validItems: Array, filteredItems: Array }}
 */
function filterItems(items) {
  const excludeRules = all(
    'SELECT * FROM category_rules WHERE rule_type = ? AND enabled = 1 ORDER BY priority DESC',
    ['exclude']
  );

  const includeRules = all(
    'SELECT * FROM category_rules WHERE rule_type = ? AND enabled = 1 ORDER BY priority DESC',
    ['include']
  );

  const validItems = [];
  const filteredItems = [];

  for (const item of items) {
    const searchText = (item.title + ' ' + (item.summary || '')).toLowerCase();

    // 先检查排除规则
    let excluded = false;
    let excludeReason = '';

    for (const rule of excludeRules) {
      if (rule.pattern && searchText.includes(rule.pattern.toLowerCase())) {
        excluded = true;
        excludeReason = `命中排除规则: ${rule.pattern}`;
        break;
      }
    }

    if (excluded) {
      filteredItems.push({
        ...item,
        is_valid: 0,
        filter_reason: excludeReason,
      });
      continue;
    }

    // 再检查包含规则（命中则填充分类）
    for (const rule of includeRules) {
      if (rule.pattern && searchText.includes(rule.pattern.toLowerCase())) {
        item.category_l1 = item.category_l1 || rule.category_l1;
        item.category_l2 = item.category_l2 || rule.category_l2;
        break;
      }
    }

    // 未命中包含规则但也没被排除 -> 保留为有效（兜底）
    validItems.push({
      ...item,
      is_valid: 1,
      filter_reason: '',
    });
  }

  return { validItems, filteredItems };
}

module.exports = { filterItems };
