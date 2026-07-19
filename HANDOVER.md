# Knowledge Vault 项目交接文档

> 最后更新：2026-07-16
> 状态：采集分治 + Markdown 知识库 + description + Wiki 蒸馏层 + 问答助手 已完成并验证

---

## 一、项目是什么

**Knowledge Vault** 是一个个人收藏知识采集与知识库整理系统。用户提交 B站/抖音/小红书/微信公众号的链接，系统自动解析内容、用 AI 做内容级分类、生成摘要和 description，最终整理成**真实的 Markdown 文件知识库**（外部 AI / Obsidian 可直接读磁盘）。

核心价值：把"收藏了等于没收藏"的内容，变成可检索、可分类、带正文、供问答助手渐进式加载的知识资产。

---

## 二、当前完成度

### ✅ 已完成并验证（方案 B / C / D / E / F）

| 功能 | 说明 |
|---|---|
| 视频内容提取 | yt-dlp 提取标题、作者、简介、字幕（不下载视频本体） |
| 微信图文提取 | HTTP 抓取公众号文章正文（不走 yt-dlp） |
| 抖音短链/口令解析 | v.douyin.com 短链重定向 + 分享口令文本提取 URL |
| 采集分治（方案C） | 按平台内容类型分发：图文走 HTTP、视频走 yt-dlp |
| AI 内容级分类 | 调硅基流动 Qwen3-8B，判断是否有效知识 + 三级分类 |
| AI 摘要 + 标签 + description | 生成摘要、标签，以及 description（供问答助手检索预筛） |
| 规则引擎过滤 | exclude 排除娱乐内容（优先级最高） |
| **Markdown 文件系统（方案D）** | 采集生成真实 .md 到 `kb-wiki/`，前端文件浏览器增删改查 |
| **description 渐进式检索（方案E）** | 每个 md 带 description 字段，问答助手先扫 description 预筛再读正文 |
| 重新提取 | 单条/全部重新跑提取 + AI，补正文和 description，覆盖 md |
| **Wiki 蒸馏层（方案F）** | AI 把 raw 原文蒸馏成 wiki/ 交叉链接知识页（[[wikilink]]），保留 description，lint 断链 |
| **问答助手（方案F）** | 两阶段检索 wiki 层：预筛 description -> 读正文流式答题 + 引用来源卡片，SSE 流式 + 多轮对话 |
| 知识库 CRUD | 列表、详情、编辑、批量操作、URL 去重、内容指纹去重 |
| 交叉链接 | 按分类+标签实时计算相关收藏 |
| 分层检索 | 默认查标题摘要（快），searchFull 扩展到正文全文 |
| 四平台导入 | B站、抖音、小红书、微信（手动链接 + CSV/JSON 文件） |

### 📊 当前数据（2026-07-15）
- 数据库 8 条条目，7 有效 / 1 已过滤
- 全部 8 条有正文 + description
- `kb-wiki/raw/articles/` 下 7 个 .md 文件（已过滤的不生成）
- 表结构含 21 列（含 content_text/description/md_path/ai_source 等）

### ⚠️ 已知限制

| 限制 | 说明 |
|---|---|
| B站字幕需 cookie | 无 cookie 时只有简介（已纳入正文），无字幕全文 |
| 抖音无 cookie 提取受限 | yt-dlp 对抖音要求 "Fresh cookies"，无 cookie 降级用标题 |
| 重新提取会重跑 AI 分类 | 可能把手动过滤的条目翻案为有效（如游戏内容被改判） |
| 微信失效链接 | 返回占位页（"参数错误"），需提供有效文章链接 |

### 📋 后续规划（未实现）

- wiki/ 层进一步蒸馏：从 raw/ 蒸馏更多概念/实体/主题页，建交叉链接（蒸馏引擎已就位，可随时重跑）
- 嵌入向量检索：当前用 description 拼接预筛，上千条后需换向量检索
- 知识图谱可视化
- 更多平台（知乎、少数派、GitHub Stars）

---

## 三、架构

### 数据流（双写）

```
用户提交链接（可留空标题，系统自动提取）
    │
    ▼
┌─────────────────────────────────────────┐
│ Node 后端（Express 5，端口 3001）      │
│                                         │
│  0. url-utils 短链/口令解析（抖音）     │
│  1. extractor 分发                      │
│     - 图文(wechat) -> extractor-article │
│       HTTP 抓公众号正文                 │
│     - 视频(B/抖/红) -> extractVideo    │
│       yt-dlp 提取 标题/简介/字幕        │
│       正文 = 简介 + 字幕                │
│  2. filter.js  exclude 规则过滤         │
│  3. classifier-ai.js                    │
│     调 Qwen3-8B                         │
│     生成 分类/摘要/标签/description     │
│     enable_thinking=false               │
│  4. knowledge.batchUpsert              │
│     URL去重 + 内容指纹去重 + 入库      │
│  5. fs-wiki.generateEntryMd             │
│     生成 .md 到 kb-wiki/raw/articles/  │
└─────────────────────────────────────────┘
    │                          │
    ▼                          ▼
SQLite(knowledge.db)    真实 .md 文件(kb-wiki/)
    │                          │
    │ 采集索引层（分类/去重/检索）  可编辑知识产出层
    │                          │（外部 AI/Obsidian 可读）
    ▼
React 前端（Vite，端口 5173）
  - 📁 知识库：文件浏览器（增删改查 .md）
  - 📥 采集导入 / 🗑️ 已过滤 / ⚙️ 规则管理
```

### 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite 5 | ESM，react-markdown 渲染预览 |
| 后端 | Express 5 + CommonJS | 端口 3001 |
| 数据库 | sql.js（SQLite） | 纯 JS，无需编译 |
| 文件系统 | Node fs | kb-wiki/ 真实 .md 文件 |
| 视频提取 | yt-dlp.exe | 单文件版，spawn 子进程 |
| AI | 硅基流动 Qwen3-8B | OpenAI 兼容 SDK，免费模型 |

---

## 四、目录结构

```
knowledge-vault/
├── agent.md                    # 原始项目规格
├── HANDOVER.md                 # 本文件
├── PLAN-B.md ~ PLAN-E.md       # 各阶段改造计划
├── start.js                    # 一键启动
│
├── server/
│   ├── .env                    # API key（gitignore）
│   ├── bin/yt-dlp.exe          # yt-dlp（gitignore，17MB）
│   ├── data/
│   │   ├── knowledge.db        # SQLite 数据库
│   │   ├── uploads/            # 上传临时文件
│   │   └── kb-wiki/            # ★ Markdown 知识库（真实文件）
│   │       ├── AGENTS.md       #   给 AI 读的 Schema 层
│   │       ├── index.md        #   自动生成的分类导航
│   │       ├── log.md          #   操作时间线（只追加）
│   │       ├── raw/articles/   #   采集内容（图文正文/视频字幕）
│   │       ├── raw/notes/      #   手动笔记
│   │       ├── wiki/           #   LLM 蒸馏层（预留）
│   │       └── templates/      #   页面模板
│   └── src/
│       ├── index.js            # 入口：initDb + initWiki + 路由
│       ├── db/
│       │   ├── index.js        # sql.js + migrateSchema + backfillMdPath
│       │   └── seed.js
│       ├── config/{categories,keywords}.js
│       ├── services/
│       │   ├── extractor.js        # ★ 分发器：图文/视频
│       │   ├── extractor-article.js # ★ 微信图文 HTTP 抓取
│       │   ├── url-utils.js         # ★ 抖音短链/口令解析
│       │   ├── classifier-ai.js     # ★ AI 分类 + description
│       │   ├── classifier.js        # 关键词降级
│       │   ├── filter.js
│       │   ├── knowledge.js        # CRUD + 去重 + findRelated
│       │   ├── linker.js            # 交叉链接
│       │   ├── fs-wiki.js           # ★ Markdown 文件系统服务
│       │   ├── reextract.js         # ★ 重新提取服务
│       │   ├── ai-client.js         # ★ AI client 共享模块（distill/qa 复用）
│       │   ├── distill.js           # ★ Wiki 蒸馏引擎（raw->交叉链接知识页）
│       │   ├── qa.js                # ★ 问答助手（检索 wiki 层，流式答题）
│       │   └── collector/           # 平台适配器
│       └── routes/
│           ├── collect.js       # 采集导入（生成 md）
│           ├── knowledge.js     # 知识库 CRUD + reextract
│           ├── category.js     # 规则管理
│           ├── wiki.js          # ★ 文件系统 API + reextract-all + distill
│           └── qa.js            # ★ 问答助手 SSE API
│
└── client/
    ├── src/
    │   ├── api/index.js        # fetch 封装 + wikiApi
    │   ├── components/
    │   │   ├── Layout/         # Header, Sidebar, Layout
    │   │   ├── Collect/        # ImportPanel, PlatformSelector, FileUploader
    │   │   ├── Knowledge/      # EntryList, EntryCard, EntryDetail
    │   │   ├── Wiki/           # ★ FileExplorer, FileTree, MarkdownEditor（蒸馏按钮）
    │   │   └── common/
    │   └── pages/
    │       ├── WikiPage.jsx    # ★ 知识库（文件浏览器，支持引用跳转打开文件）
    │       ├── QaPage.jsx      # ★ 问答助手（流式聊天 + 引用卡片）
    │       ├── ImportPage.jsx
    │       ├── FilteredPage.jsx
    │       └── RulesPage.jsx
```

★ 标记方案 C/D/E 新增或大改的模块。

---

## 五、启动方式

### 开发模式（推荐，支持热重载）

```bash
# 终端 1：后端
cd D:\zhuomian\cc-workspace\knowledge-vault\server
node --watch src/index.js

# 终端 2：前端
cd D:\zhuomian\cc-workspace\knowledge-vault\client
npx vite --host
```

访问 http://localhost:5173

### 一键启动（无热重载）

```bash
cd D:\zhuomian\cc-workspace\knowledge-vault
node start.js
```

⚠️ 后台进程会随启动它的会话结束而被清理。日常建议在独立终端跑 `node --watch`，不依赖特定会话。

---

## 六、配置说明

### 1. API Key（必填）— `server/.env`
```env
SILICONFLOW_API_KEY=sk-你的真实key
AI_BASE_URL=https://api.siliconflow.cn/v1
AI_MODEL=Qwen/Qwen3-8B
BILIBILI_COOKIE_FILE=
DOUYIN_COOKIE_FILE=   # 可选，抖音提取需要
```
key 为占位符时系统自动降级为关键词分类。

### 2. yt-dlp — `server/bin/yt-dlp.exe`（已就位）
更新：从 [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) 覆盖。

### 3. Cookie（可选但建议）
- B站 `data/bilibili-cookie.txt`（Netscape 格式）-> 提取 CC 字幕
- 抖音 `data/douyin-cookie.txt` -> 提取视频元数据

---

## 七、关键陷阱（重要！）

### 1. B站逆向 API 已违法，不可使用
2026 年 B站对逆向 API 发律师函。本项目仅保留手动链接 + yt-dlp 公开页面解析（合规）。

### 2. Qwen3 必须关闭思考
`enable_thinking: false` 关后 token 从 400+ 降到 35，耗时 19s->3s。非 Qwen3 模型传了无害。

### 3. sql.js 替代 better-sqlite3
纯 JS，无需编译。入口 `index.js` 必须在 `app.listen` 前 `await initDb()`。

### 4. 视频正文 = 简介 + 字幕
不要只取字幕（多数视频无 CC 字幕）。`extractor.js` 视频分支正文 = description + subtitleText 拼接。

### 5. 重新提取会翻案
重新提取重跑 AI 分类，可能把手动过滤的条目改判为有效。重新提取前留意。

### 6. md_path 覆盖机制
knowledge_entries 的 `md_path` 列记录对应 .md 路径，重新提取时覆盖而非生成重复文件。启动时 `backfillMdPath()` 回填历史 md。

### 7. Markdown 文件路径安全
`fs-wiki.js` 的 `assertSafePath` 用 `path.relative` 检测 `..` 逃逸，防穿越。受保护文件（AGENTS.md/index.md/log.md/templates）不可删。

### 8. Windows Git Bash 下 curl 中文乱码
测试中文 API 必须用 `curl --data-binary @file.json`。浏览器 fetch 不受影响。

### 9. SSE 必须用 res.on('close') 检测断开（不是 req.on('close')）
Node 24 / Express 5 下 `req.on('close')` 在请求体读完后立即触发（并非客户端断开），会误判中止、跳过后续 SSE 事件。`distill` 和 `qa` 路由都用 `res.on('close')`（响应连接关闭=真正断开）。这是方案F 调试中最隐蔽的坑。

### 10. Wiki 蒸馏耗时
蒸馏要多次调 AI（1 规划 + N 合成，每页生成 ~1500 token 正文约 30-40s），10 页约 3-4 分钟。前端用 SSE 流式进度（"合成 LangChain(3/10)..."）避免盲等。问答助手检索的是 wiki 蒸馏层（已加工、交叉链接），不是 raw 原文。

### 11. 问答助手兜底机制
预筛返回的标题可能不精确匹配 wiki 页标题（AI 可能返回"LangChain框架应用"而实际是"LangChain"），用 includes 模糊匹配；若全部落空则兜底取前 N 页，保证始终有素材可答。

---

## 八、API 端点

### 采集
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/collect/import` | 手动导入链接列表 |
| POST | `/api/collect/import/file` | CSV/JSON 文件批量导入 |

### 知识库
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/knowledge/entries` | 分页列表（支持 l1/l2/platform/search/valid/searchFull） |
| GET | `/api/knowledge/entries/:id` | 单条详情 |
| PUT | `/api/knowledge/entries/:id` | 编辑条目 |
| DELETE | `/api/knowledge/entries/:id` | 删除条目 |
| POST | `/api/knowledge/entries/batch` | 批量操作 |
| GET | `/api/knowledge/entries/:id/related` | 相关收藏（交叉链接） |
| POST | `/api/knowledge/entries/:id/reextract` | ★ 重新提取单条 |
| GET | `/api/knowledge/stats` | 统计信息 |
| GET | `/api/knowledge/filtered` | 已过滤条目列表 |

### ★ 知识库文件系统
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/wiki/tree` | 目录树（递归） |
| GET | `/api/wiki/file?path=` | 读 .md 内容 |
| POST | `/api/wiki/file` | 新建 .md |
| PUT | `/api/wiki/file?path=` | 写/改 .md |
| DELETE | `/api/wiki/file?path=` | 删 .md |
| POST | `/api/wiki/regenerate` | 从数据库重新生成所有 .md |
| POST | `/api/wiki/reextract-all?onlyEmpty=true` | ★ 重新提取全部 |
| POST | `/api/wiki/distill` | ★ 蒸馏：raw -> wiki 交叉链接知识页（SSE 流式进度） |

### ★ 问答助手
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/qa/ask` | SSE 流式问答，body `{question, history}`，事件 status/citations/delta/done/error |

### 分类规则
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/categories/tree` | 完整分类树 |
| GET/POST | `/api/categories/rules` | 规则列表/新增 |
| PUT/DELETE | `/api/categories/rules/:id` | 编辑/删除规则 |

所有 API 返回 `{ success, data, error? }`。

---

## 九、Markdown 文件格式

```markdown
---
id: 12                          # 数据库条目 ID
title: React 19 新特性完全指南
source: wechat                  # 采集平台
author: 前端技术精选
url: https://mp.weixin.qq.com/s/xxx
category: 科学技术/计算机与编程/前端开发  # 三级分类
tags: [React, 前端开发]
summary: React 19 新特性介绍          # 给人看的摘要
description: 主题+关键词+适用场景       # 给问答助手检索预筛
collected_at: 2026-07-15T15:30:00Z
ai_source: full_content          # full_content/partial/title_only/keyword_fallback
ai_confidence: high              # high/medium/low
---

# 标题

正文内容（图文正文 / 视频简介+字幕）
```

### description 用途（渐进式检索，参考 SKILL）
问答助手工作流：
1. 收集所有 md 的 description（轻量，不读正文）
2. 模型判断哪些相关
3. 只读相关条目的正文 -> 组织答案

省 token，大库可跑。详见 `kb-wiki/AGENTS.md`。

---

## 十、相关文档

- `agent.md`：原始项目规格
- `PLAN-B.md`：AI 内容级分类改造
- `PLAN-C.md`：采集分治（微信图文/抖音短链）
- `PLAN-D.md`：Markdown 文件系统
- `PLAN-E.md`：提取修复 + description 渐进式检索
- `PLAN-F.md`：Wiki 蒸馏层 + 问答助手计划书
- `HANDOVER-F.md`：方案F 专题交接（蒸馏引擎/问答助手/SSE 陷阱，方案F 细节看这里）
- 本文件：当前状态交接

---

## 十一、快速验证清单

接手后按这个清单跑一遍，确认环境正常：

- [ ] `server/bin/yt-dlp.exe --version` 返回版本号
- [ ] `server/.env` 里 `SILICONFLOW_API_KEY` 是真实 key
- [ ] 启动后端，日志显示「知识库文件系统已就绪」+「种子数据已插入」
- [ ] `curl http://localhost:3001/api/health` 返回 ok
- [ ] 启动前端，http://localhost:5173 可打开
- [ ] 「📁 知识库」页能看到文件树，点文件能编辑/预览
- [ ] 导入一个微信文章 -> md 生成在 raw/articles/，含正文+description
- [ ] 详情/编辑器有「🔄 重新提取」按钮
- [ ] `server/data/kb-wiki/AGENTS.md` 存在（给 AI 读的 Schema）
