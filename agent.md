# knowledge-vault — 收藏知识采集与知识库整理系统

## 项目概述

一款多平台收藏知识采集与个人知识库整理系统。支持从 B站、抖音、小红书、微信公众号手动导入收藏内容，通过规则引擎自动过滤娱乐信息、用 AI 做内容级分类，并把每个内容生成**真实 Markdown 文件**整理成结构化个人知识库（外部 AI / Obsidian 可直接读磁盘）。

每个知识条目带 `description` 字段（关键词 + 适用场景），供未来问答助手做"先扫 description 预筛、命中再读正文"的渐进式检索（参考 SKILL 设计）。

详细当前状态见 `HANDOVER.md`，各阶段改造计划见 `PLAN-B.md` ~ `PLAN-E.md`。

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite 5 | ESM 单页应用，react-markdown 渲染预览 |
| 后端 | Express 5 + CommonJS | RESTful API，端口 3001 |
| 数据库 | SQLite (sql.js) | 纯 JS，无需编译，替代原 better-sqlite3 |
| 文件系统 | Node fs | `server/data/kb-wiki/` 真实 .md 文件，外部可访问 |
| 视频提取 | yt-dlp.exe | 单文件版，spawn 子进程调用 |
| AI | 硅基流动 Qwen3-8B | OpenAI 兼容 SDK，免费模型 |
| 运行时 | Node.js ≥ 18 | 纯 JS 全栈，无额外依赖服务 |

## 项目结构

```
knowledge-vault/
├── client/                    # React + Vite 前端
│   ├── src/
│   │   ├── api/               # API 请求封装
│   │   │   └── index.js       #    fetch 封装，统一错误处理
│   │   ├── components/        # UI 组件
│   │   │   ├── Layout/        #    Header.jsx, Sidebar.jsx
│   │   │   ├── Collect/       #    ImportPanel.jsx, PlatformSelector.jsx, FileUploader.jsx
│   │   │   ├── Knowledge/     #    EntryList.jsx, EntryCard.jsx, EntryDetail.jsx, CategoryTree.jsx
│   │   │   └── common/        #    Badge, EmptyState, LoadingSpinner, Modal
│   │   ├── hooks/             # 自定义 Hooks
│   │   │   ├── useEntries.js  #    知识条目列表、筛选、分页
│   │   │   └── useCategories.js #  分类树数据
│   │   ├── styles/
│   │   │   └── index.css      #    全局样式 + CSS 变量
│   │   ├── App.jsx            #    路由 + 布局
│   │   └── main.jsx           #    入口
│   ├── index.html
│   ├── vite.config.js         #    开发代理 → localhost:3001
│   └── package.json
├── server/
│   ├── src/
│   │   ├── index.js           #    入口：Express 启动、中间件、路由挂载
│   │   ├── routes/
│   │   │   ├── collect.js     #    采集导入 API
│   │   │   ├── knowledge.js   #    知识库 CRUD API
│   │   │   └── category.js    #    分类规则 API
│   │   ├── services/
│   │   │   ├── collector/     #    采集器模块
│   │   │   │   ├── index.js        #     入口：routeToAdapter()
│   │   │   │   ├── bilibili.js     #     B站 API 适配器
│   │   │   │   ├── douyin.js       #     抖音链接/CSV 解析适配器
│   │   │   │   ├── xiaohongshu.js  #     小红书 JSON/CSV 解析适配器
│   │   │   │   └── wechat.js       #     微信链接解析适配器
│   │   │   ├── filter.js      #    内容过滤引擎（正向+反向规则）
│   │   │   ├── classifier.js  #    多级自动分类器
│   │   │   └── knowledge.js   #    知识库 CRUD + 去重 + 统计
│   │   ├── config/
│   │   │   ├── keywords.js    #    过滤 & 分类关键词库
│   │   │   └── categories.js  #    分类层级定义（3级）
│   │   ├── db/
│   │   │   ├── index.js       #    sql.js 初始化 + 建表 + 迁移
│   │   │   └── seed.js        #    预设分类规则 & 关键词种子数据
│   │   └── middleware/
│   │       └── errorHandler.js
│   ├── data/                  # SQLite 数据库文件 (.gitignore)
│   └── package.json
├── package.json               # 根 monorepo 脚本 (dev/build/start)
├── start.js                   # 一键启动 (spawn server + client)
└── agent.md                   # 本文件
```

## 数据模型

### SQLite 表

**knowledge_entries** — 知识条目主表：
| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增主键 |
| title | TEXT | 标题 |
| url | TEXT | 原始链接 |
| source_platform | TEXT | bilibili / douyin / xiaohongshu / wechat |
| source_author | TEXT | 原作者 |
| summary | TEXT | AI 生成的内容摘要（给人看） |
| category_l1 | TEXT | 一级分类 |
| category_l2 | TEXT | 二级分类 |
| category_l3 | TEXT | 三级分类 |
| tags | TEXT | JSON 数组字符串 |
| is_valid | INTEGER | 1=有效知识, 0=已过滤 |
| filter_reason | TEXT | 被过滤原因 |
| collected_at | TEXT | 采集时间 ISO |
| content_text | TEXT | 完整正文（图文正文 / 视频简介+字幕） |
| content_hash | TEXT | 正文指纹 MD5（跨 URL 去重） |
| ai_source | TEXT | AI 分类依据：full_content/partial_content/title_only/keyword_fallback/rule_filter |
| ai_confidence | TEXT | 置信度：high/medium/low |
| description | TEXT | 检索描述（关键词+适用场景，供问答助手预筛） |
| md_path | TEXT | 对应的 .md 文件路径（覆盖映射） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

> schema 迁移：`db/index.js` 的 `migrateSchema()` 用 `PRAGMA table_info` 检测列，不存在则 `ALTER TABLE ADD COLUMN`，兼容旧库。启动时 `backfillMdPath()` 扫描已生成的 .md 回填 md_path。

**collect_logs** — 采集记录：
| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增 |
| source_platform | TEXT | 平台 |
| item_count | INTEGER | 导入总数 |
| valid_count | INTEGER | 有效数量 |
| status | TEXT | pending/processing/done/error |
| error_message | TEXT | 错误信息 |
| created_at | TEXT | 创建时间 |

**category_rules** — 分类规则：
| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增 |
| rule_type | TEXT | include / exclude / classify |
| target_field | TEXT | 匹配字段（title/summary） |
| pattern | TEXT | 关键词 |
| category_l1 | TEXT | 一级分类 |
| category_l2 | TEXT | 二级分类 |
| priority | INTEGER | 优先级 |
| enabled | INTEGER | 启用 |
| created_at | TEXT | 创建时间 |

## 核心业务流程

```
用户输入（链接/文件/Cookie）
       │
       ▼
┌─────────────────┐
│  采集器入口       │  → routeToAdapter(platform)
│  collector/index │
└────────┬────────┘
         │
    ┌────┴────┬─────────┬──────────┐
    ▼         ▼         ▼          ▼
 bilibili   douyin  xiaohongshu  wechat
 (API)     (CSV)   (JSON/CSV)   (链接)
    │         │         │          │
    └────┬────┴─────────┴──────────┘
         │  统一 Item[] 格式
         ▼
┌─────────────────┐
│  过滤引擎        │  → filterItems(items)
│  filter.js      │     规则: exclude 优先 → include 兜底
└────────┬────────┘
         │  validItems[] + filteredItems[]
         ▼
┌─────────────────┐
│  分类器          │  → classifyItems(validItems)
│  classifier.js  │     匹配 category_rules → 自动归类
└────────┬────────┘
         │  classifiedItems[]
         ▼
┌─────────────────┐
│  知识库整理      │  → dedup + store + stats
│  knowledge.js   │     URL 去重，写入 SQLite
└────────┬────────┘
         │
         ▼
     前端展示（分类树 + 列表 + 详情）
```

## API 端点

### 采集

| 方法 | 路径 | 请求体 | 说明 |
|------|------|--------|------|
| POST | `/api/collect/import` | `{ platform, items: [{title,url}] }` | 手动导入链接列表 |
| POST | `/api/collect/import/file` | multipart CSV/JSON 文件 | 文件批量导入 |

### 知识库

| 方法 | 路径 | 查询参数 | 说明 |
|------|------|----------|------|
| GET | `/api/knowledge/entries` | `?page=&pageSize=&l1=&l2=&platform=&search=&valid=&searchFull=` | 分页列表（searchFull=1 扩展到正文全文） |
| GET | `/api/knowledge/entries/:id` | — | 单条详情 |
| PUT | `/api/knowledge/entries/:id` | body: 更新字段 | 编辑条目 |
| DELETE | `/api/knowledge/entries/:id` | — | 删除条目 |
| POST | `/api/knowledge/entries/batch` | `{ ids, action }` | 批量操作 |
| GET | `/api/knowledge/entries/:id/related` | - | 相关收藏（交叉链接） |
| POST | `/api/knowledge/entries/:id/reextract` | - | 重新提取单条（正文+description） |
| GET | `/api/knowledge/stats` | — | 分类/平台统计 |
| GET | `/api/knowledge/filtered` | `?page=&pageSize=` | 已过滤条目列表 |

### 知识库文件系统（Markdown）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/wiki/tree` | 目录树（递归 raw/ + wiki/） |
| GET | `/api/wiki/file?path=` | 读 .md 内容 |
| POST | `/api/wiki/file` | 新建 .md（body: {path, content}） |
| PUT | `/api/wiki/file?path=` | 写/改 .md |
| DELETE | `/api/wiki/file?path=` | 删 .md |
| POST | `/api/wiki/regenerate` | 从数据库重新生成所有 .md |
| POST | `/api/wiki/reextract-all?onlyEmpty=true` | 重新提取全部（补正文+description） |

### 分类

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories/tree` | 完整分类树 |
| GET | `/api/categories/rules` | 分类规则列表 |
| POST | `/api/categories/rules` | 新增规则 |
| PUT | `/api/categories/rules/:id` | 编辑规则 |
| DELETE | `/api/categories/rules/:id` | 删除规则 |

## 关键词 & 分类体系

### 过滤维度

**排除类 (exclude)** — 命中则直接标记 `is_valid=0`：
- 纯娱乐：搞笑、翻拍、段子、恶搞、吃播、挑战、鬼畜、vlog、日常
- 影视综艺：综艺、电视剧、电影解说、娱乐八卦、明星、饭圈
- 游戏（非教学类）：游戏实况、通关视频、抽卡、开箱
- 社会热点（非知识类）：社会新闻、车祸、纠纷、情感故事

**包含类 (include)** — 命中则标记为有效知识候选：
- 编程/IT：编程、代码、Python、Java、前端、后端、算法、开源、GitHub
- 科学技术：物理、数学、生物、化学、AI、机器学习、航天
- 人文社科：历史、哲学、经济学、心理学、社会学、政治
- 职业技能：面试、简历、职场、PPT、Excel、效率工具
- 艺术设计：设计、绘画、摄影、色彩、字体、UI/UX
- 语言学习：英语、日语、语法、单词、发音
- 健康生活：营养、健身、医学、心理健康
- 金融财经：投资、股票、基金、理财、保险

### 分类层级（预设）

```
科学技术
├── 计算机与编程
│   ├── 编程语言
│   ├── 前端开发
│   ├── 后端开发
│   └── 人工智能
├── 数学与逻辑
├── 物理与工程
├── 生物与医学
└── 航天与天文

人文社科
├── 历史与考古
├── 哲学与思想
├── 心理与认知
├── 经济与商业
├── 社会与政治
└── 法律与法规

职业技能
├── 求职面试
├── 办公效率
├── 项目管理
├── 沟通表达
└── 创业管理

艺术设计
├── UI/UX 设计
├── 平面与视觉
├── 摄影与后期
└── 绘画与插画

健康生活
├── 运动健身
├── 营养饮食
├── 心理健康
└── 医学科普

语言学习
├── 英语
├── 日语
├── 其他语种
└── 学习方法论

商业财经
├── 投资理财
├── 商业案例
├── 市场分析
└── 个人财务
```

## 开发约定

### 后端
- CommonJS (`require/module.exports`)，与现有 `ai-hotlist-dashboard/server` 保持一致
- 异步操作统一 try/catch，错误由 errorHandler 中间件兜底
- 所有 API 返回格式 `{ success: boolean, data: any, error?: string }`
- 采集器适配器必须实现 `normalize(raw) → { title, url, source_platform, summary }[]` 接口

### 前端
- ESM (`import/export`)
- 组件采用 CSS Modules（`.module.css`），与现有项目模式一致
- 自定义 hook 负责数据获取和状态管理，组件只负责渲染
- 颜色/间距使用 CSS 变量，定义在 `index.css` 根级别

### 通用
- 平台标识符统一使用小写英文：`bilibili` / `douyin` / `xiaohongshu` / `wechat`
- 日期时间统一 ISO 8601 格式
- 标签存储为 JSON 字符串数组：`["tag1","tag2"]`

## 启动方式

```bash
# 安装依赖
cd knowledge-vault
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 开发运行（同时启动前后端）
npm run dev

# 仅后端
npm run dev:server

# 仅前端
npm run dev:client
```

## 已实现（原二期规划项）
- ✅ AI 驱动分类（硅基流动 Qwen3-8B，内容级分类）
- ✅ 原文内容抓取与离线存档（content_text 存正文 + kb-wiki/ 真实 md 文件）
- ✅ 知识条目去重（URL 去重 + 内容指纹 content_hash 去重）
- ✅ 导出功能（Markdown 文件系统即导出，外部 AI/Obsidian 可读磁盘）
- ✅ 搜索全文检索（searchFull=1 扩展到正文全文）
- ✅ description 渐进式检索字段（供问答助手预筛，参考 SKILL）

## 后续规划（未实现）
- 问答助手（读各 md 的 description 预筛，命中读正文组织答案；AGENTS.md Schema 已就位）
- wiki/ 层 AI 蒸馏（从 raw/ 蒸馏概念/实体/主题页，建交叉链接）
- 知识图谱可视化
- 语义级合并去重（当前仅内容指纹）
- 收藏标签自定义
- 更多平台支持（知乎、少数派、GitHub Stars 等）
- PDF 导出
- 飞书/微信机器人落地形态
