const { Router } = require('express');
const service = require('../services/knowledge');
const { reextractEntry } = require('../services/reextract');

const router = Router();

/**
 * GET /api/knowledge/entries
 * 分页列表
 */
router.get('/entries', (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, l1, l2, platform, search, valid, searchFull } = req.query;
    const result = service.getEntries({
      page: Number(page),
      pageSize: Number(pageSize),
      l1,
      l2,
      platform,
      search,
      valid,
      searchFull: searchFull === 'true' || searchFull === '1',
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/knowledge/entries/:id/related
 * 某条目的相关收藏（交叉链接）
 */
router.get('/entries/:id/related', (req, res, next) => {
  try {
    const related = service.findRelated(Number(req.params.id));
    res.json({ success: true, data: related });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/knowledge/entries/:id/reextract
 * 重新提取单条：提取正文 + AI 生成 description/分类 + 更新库 + 覆盖 md
 */
router.post('/entries/:id/reextract', async (req, res, next) => {
  try {
    const result = await reextractEntry(Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/knowledge/entries/:id
 * 单条详情
 */
router.get('/entries/:id', (req, res, next) => {
  try {
    const entry = service.getEntry(Number(req.params.id));
    if (!entry) {
      return res.status(404).json({ success: false, error: '条目不存在' });
    }
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/knowledge/entries/:id
 * 编辑条目
 */
router.put('/entries/:id', (req, res, next) => {
  try {
    const updated = service.updateEntry(Number(req.params.id), req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: '条目不存在' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/knowledge/entries/:id
 * 删除条目
 */
router.delete('/entries/:id', (req, res, next) => {
  try {
    const result = service.deleteEntry(Number(req.params.id));
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '条目不存在' });
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/knowledge/entries/batch
 * 批量操作
 * Body: { ids: number[], action: 'delete' | 'mark_valid' | 'mark_invalid' }
 */
router.post('/entries/batch', (req, res, next) => {
  try {
    const { ids, action } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 ids 参数' });
    }
    const result = service.batchOperation(ids, action);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/knowledge/stats
 * 统计信息
 */
router.get('/stats', (req, res, next) => {
  try {
    const stats = service.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/knowledge/filtered
 * 已过滤条目列表
 */
router.get('/filtered', (req, res, next) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = service.getFilteredEntries({
      page: Number(page),
      pageSize: Number(pageSize),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
