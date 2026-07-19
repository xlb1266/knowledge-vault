// 加载环境变量（必须在其他 require 之前，AI 模块依赖它）
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { errorHandler } = require('./middleware/errorHandler');
const { initDb } = require('./db');
const { seed } = require('./db/seed');
const { initWiki } = require('./services/fs-wiki');

// 路由
const collectRoutes = require('./routes/collect');
const knowledgeRoutes = require('./routes/knowledge');
const categoryRoutes = require('./routes/category');
const wikiRoutes = require('./routes/wiki');
const qaRoutes = require('./routes/qa');

const PORT = process.env.PORT || 3001;

async function startServer() {
  // 先初始化数据库（sql.js 是异步加载 wasm）
  await initDb();

  // 写入种子数据
  try {
    seed();
  } catch (err) {
    console.error('种子数据初始化失败:', err.message);
  }

  // 初始化知识库文件系统（生成 kb-wiki/ 目录骨架 + AGENTS.md 等）
  try {
    initWiki();
    console.log('✓ 知识库文件系统已就绪 (server/data/kb-wiki/)');
  } catch (err) {
    console.error('知识库文件系统初始化失败:', err.message);
  }

  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 路由挂载
  app.use('/api/collect', collectRoutes);
  app.use('/api/knowledge', knowledgeRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/wiki', wikiRoutes);
  app.use('/api/qa', qaRoutes);

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
  });

  // 生产环境：托管前端构建产物
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // 错误处理中间件
  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`🚀 Knowledge Vault API 运行在 http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});
