const { Router } = require('express');
const fsWiki = require('../services/fs-wiki');
const service = require('../services/knowledge');
const { reextractAll } = require('../services/reextract');
const { distillAll } = require('../services/distill');

const router = Router();

/**
 * GET /api/wiki/tree
 * 返回 kb-wiki 目录树
 */
router.get('/tree', (req, res, next) => {
  try {
    const tree = fsWiki.listTree();
    res.json({ success: true, data: tree });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/wiki/file?path=
 * 读取单个 .md 文件内容
 */
router.get('/file', (req, res, next) => {
  try {
    const { path: relPath } = req.query;
    if (!relPath) {
      return res.status(400).json({ success: false, error: '缺少 path 参数' });
    }
    const file = fsWiki.readFile(relPath);
    res.json({ success: true, data: file });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/wiki/file
 * 新建 .md 文件
 * Body: { path, content }
 */
router.post('/file', (req, res, next) => {
  try {
    const { path: relPath, content } = req.body;
    if (!relPath) {
      return res.status(400).json({ success: false, error: '缺少 path 参数' });
    }
    const result = fsWiki.createFile(relPath, content || '');
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/wiki/file?path=
 * 写入/更新 .md 文件内容
 * Body: { content }
 */
router.put('/file', (req, res, next) => {
  try {
    const { path: relPath } = req.query;
    const { content } = req.body;
    if (!relPath) {
      return res.status(400).json({ success: false, error: '缺少 path 参数' });
    }
    const result = fsWiki.writeFile(relPath, content ?? '');
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/wiki/file?path=
 * 删除 .md 文件
 */
router.delete('/file', (req, res, next) => {
  try {
    const { path: relPath } = req.query;
    if (!relPath) {
      return res.status(400).json({ success: false, error: '缺少 path 参数' });
    }
    const result = fsWiki.deleteFile(relPath);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/wiki/regenerate
 * 从数据库重新生成所有有效条目的 .md（补历史数据）
 */
router.post('/regenerate', (req, res, next) => {
  try {
    // 拉所有有效条目（含 content_text）
    const all = service.getAllEntriesForWiki();
    const result = fsWiki.regenerateAll(all);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/wiki/reextract-all?onlyEmpty=true
 * 重新提取全部条目：提取正文 + AI 生成 description/分类 + 覆盖 md
 * onlyEmpty=true 只处理正文为空的（默认）
 * 耗时操作（每条 5-15 秒），同步等待完成
 */
router.post('/reextract-all', async (req, res, next) => {
  try {
    const onlyEmpty = req.query.onlyEmpty !== 'false';
    const result = await reextractAll({ onlyEmpty });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/wiki/distill
 * 蒸馏知识库：raw 条目 -> wiki/{五类} 交叉链接知识页（带 description）
 * SSE 流式返回进度（多次调 AI，约 2-4 分钟）
 * 事件：{type:'progress', stage, ...} / {type:'done', ...} / {type:'error', message}
 */
router.post('/distill', async (req, res, next) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let aborted = false;
  // 用 res 'close'（响应连接关闭=客户端真正断开）而非 req 'close'
  // （req 'close' 在请求体读完后即触发，会误判中止，导致后续 SSE 事件被跳过）
  res.on('close', () => { aborted = true; });

  const send = (payload) => {
    if (!aborted) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await distillAll((stage, payload) => {
      send({ type: 'progress', stage, ...(payload || {}) });
    });
    if (result.error) {
      send({ type: 'error', message: result.error });
    } else {
      send({ type: 'done', ...result });
    }
    if (!aborted) res.end();
  } catch (err) {
    send({ type: 'error', message: err.message });
    if (!aborted) res.end();
  }
});

module.exports = router;
