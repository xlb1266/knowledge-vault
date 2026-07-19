const { Router } = require('express');
const { answerQuestionStream } = require('../services/qa');

const router = Router();

/**
 * POST /api/qa/ask
 * 问答助手（SSE 流式）
 * Body: { question: string, history?: [{role, content}] }
 * 事件：
 *   {type:'status', message}
 *   {type:'citations', items:[{index,title,type,path,source_ids}]}
 *   {type:'delta', text}
 *   {type:'done'}
 *   {type:'error', message}
 */
router.post('/ask', async (req, res, next) => {
  const { question, history = [] } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ success: false, error: '缺少 question' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let aborted = false;
  // 用 res 'close'（响应连接关闭=客户端真正断开）而非 req 'close'
  // （req 'close' 在请求体读完后即触发，会误判中止，导致后续 SSE 事件被跳过）
  res.on('close', () => { aborted = true; });

  const send = (type, payload) => {
    if (aborted) return;
    res.write(`data: ${JSON.stringify({ type, ...(payload || {}) })}\n\n`);
  };

  try {
    await answerQuestionStream(question, history, send);
    if (!aborted) res.end();
  } catch (err) {
    console.error('[qa] 流式问答异常:', err.message);
    send('error', { message: err.message });
    if (!aborted) res.end();
  }
});

module.exports = router;
