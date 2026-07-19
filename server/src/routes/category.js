const { Router } = require('express');
const { run, all, get } = require('../db');
const { buildTree } = require('../config/categories');

const router = Router();

/**
 * GET /api/categories/tree
 * 完整分类树
 */
router.get('/tree', (req, res) => {
  const tree = buildTree();
  res.json({ success: true, data: tree });
});

/**
 * GET /api/categories/rules
 * 分类规则列表
 */
router.get('/rules', (req, res, next) => {
  try {
    const { rule_type, enabled } = req.query;
    let sql = 'SELECT * FROM category_rules WHERE 1=1';
    const params = [];

    if (rule_type) {
      sql += ' AND rule_type = ?';
      params.push(rule_type);
    }
    if (enabled !== undefined && enabled !== '') {
      sql += ' AND enabled = ?';
      params.push(Number(enabled));
    }
    sql += ' ORDER BY priority DESC, id ASC';

    const rules = all(sql, params);
    res.json({ success: true, data: rules });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/categories/rules
 * 新增规则
 */
router.post('/rules', (req, res, next) => {
  try {
    const { rule_type, target_field, pattern, category_l1, category_l2, category_l3, priority, enabled } = req.body;

    if (!rule_type || !pattern) {
      return res.status(400).json({ success: false, error: 'rule_type 和 pattern 为必填项' });
    }

    const result = run(
      `INSERT INTO category_rules
        (rule_type, target_field, pattern, category_l1, category_l2, category_l3, priority, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule_type,
        target_field || 'title',
        pattern,
        category_l1 || '',
        category_l2 || '',
        category_l3 || '',
        priority || 0,
        enabled != null ? enabled : 1,
      ]
    );

    const newRule = get('SELECT * FROM category_rules WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, data: newRule });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/categories/rules/:id
 * 编辑规则
 */
router.put('/rules/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = get('SELECT * FROM category_rules WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: '规则不存在' });
    }

    const allowed = ['rule_type', 'target_field', 'pattern', 'category_l1', 'category_l2', 'category_l3', 'priority', 'enabled'];
    const sets = [];
    const params = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }

    if (sets.length === 0) {
      return res.json({ success: true, data: existing });
    }

    params.push(id);
    run(`UPDATE category_rules SET ${sets.join(', ')} WHERE id = ?`, params);

    const updated = get('SELECT * FROM category_rules WHERE id = ?', [id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/categories/rules/:id
 * 删除规则
 */
router.delete('/rules/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = get('SELECT * FROM category_rules WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: '规则不存在' });
    }

    run('DELETE FROM category_rules WHERE id = ?', [id]);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
