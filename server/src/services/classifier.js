const { all } = require('../db');

/**
 * 多级自动分类器
 * 基于 category_rules 中的 classify 规则匹配标题和摘要
 * @param {Array} items - 待分类条目
 * @returns {Array} 已分类条目
 */
function classifyItems(items) {
  const classifyRules = all(
    'SELECT * FROM category_rules WHERE rule_type = ? AND enabled = 1 ORDER BY priority DESC',
    ['classify']
  );

  return items.map((item) => {
    const searchText = (item.title + ' ' + (item.summary || '')).toLowerCase();

    // 查找匹配的分类规则，按优先级填充更细分类
    for (const rule of classifyRules) {
      if (rule.pattern && searchText.includes(rule.pattern.toLowerCase())) {
        item.category_l1 = item.category_l1 || rule.category_l1;
        item.category_l2 = item.category_l2 || rule.category_l2;
        item.category_l3 = item.category_l3 || rule.category_l3;
      }
    }

    item.is_valid = 1;
    return item;
  });
}

module.exports = { classifyItems };
