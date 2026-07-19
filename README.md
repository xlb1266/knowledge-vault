# Knowledge Vault

> 多平台收藏知识采集与个人知识库整理系统 —— 从「收藏即吃灰」到「可检索、可问答、可外部读取」的个人知识中枢。

手动导入 B站 / 抖音 / 小红书 / 微信公众号的收藏链接，自动用 **yt-dlp 提取正文** + **AI 做内容级分类**，过滤掉娱乐信息，并把每条知识生成**真实 Markdown 文件**，整理成结构化的 Obsidian 风格知识库。在原文之上还有 **AI 蒸馏的 Wiki 知识页**与**流式问答助手**，让收藏真正可被检索和追问。

## ✨ 特性

- **多平台采集**：B站 / 抖音 / 小红书 / 微信公众号，按内容类型分治（视频走 yt-dlp、图文走 HTTP 抓取、抖音口令自动解析短链）
- **AI 内容级分类**：硅基流动 Qwen3-8B 读取标题 + 简介 + 字幕判定分类，远比关键词匹配准确（已修复「Gonna」误判为 Go 语言的经典坑）
- **规则引擎过滤**：125 条种子规则，exclude 优先 / include 兜底，自动剔除搞笑、综艺、游戏实况等纯娱乐内容
- **真实 Markdown 文件系统**：采集即生成 `.md` 文件到 `kb-wiki/`，带 YAML frontmatter，外部 AI / Obsidian 可直接读磁盘
- **内容指纹去重**：跨 URL 同内容自动识别（MD5 正文指纹），支持分层检索（标题摘要快查 / 正文全文慢查）
- **交叉链接**：实时计算相关条目（同分类 / 共同标签 / 同平台加权评分）
- **Wiki 蒸馏层**：AI 从 raw 原文蒸馏出概念 / 实体 / 主题页，自动建立 `[[wikilink]]` 交叉引用，零断链
- **流式问答助手**：两阶段渐进检索（先扫所有 wiki 页 description 预筛 → 读相关正文流式答题 + 引用溯源），SSE 逐字输出、支持多轮

## 🧱 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite 5 | ESM 单页应用，react-markdown 渲染预览 |
| 后端 | Express 5 + CommonJS | RESTful API，端口 3001 |
| 数据库 | SQLite (sql.js) | 纯 JS WASM，**免 C++ 编译**（替代 better-sqlite3） |
| 文件系统 | Node fs | `server/data/kb-wiki/` 真实 .md 文件 |
| 视频提取 | yt-dlp | 单文件 exe，spawn 子进程调用 |
| AI | 硅基流动 Qwen3-8B | OpenAI 兼容接口，免费模型 |
| 运行时 | Node.js ≥ 18 | 纯 JS 全栈，无额外依赖服务 |

## 🏗️ 架构

```
用户提交链接（B站/抖音/小红书/微信）
        │
        ▼
┌───────────────────┐
│  采集分治          │  extractor.js
│  视频→yt-dlp       │  图文→HTTP 抓取
└────────┬──────────┘
         ▼
┌───────────────────┐
│  规则过滤          │  filter.js（exclude 优先 > include 兜底）
└────────┬──────────┘
         ▼
┌───────────────────┐
│  AI 内容分类       │  classifier-ai.js（Qwen3-8B 读正文判定 l1/l2/l3）
└────────┬──────────┘
         ▼
┌───────────────────┐
│  入库 + 生成 .md   │  knowledge.js + fs-wiki.js
└────────┬──────────┘
         ▼
   SQLite 索引层  +  kb-wiki/ 真实 .md 文件
         │
         ▼
┌───────────────────┐
│  Wiki 蒸馏（可选）  │  distill.js：raw → 交叉链接知识页
└────────┬──────────┘
         ▼
┌───────────────────┐
│  问答助手          │  qa.js：扫 description 预筛 → 读 wiki 正文流式答题
└───────────────────┘
```

**两层知识结构**（借鉴 Obsidian / Karpathy LLM-wiki 方法论）：

- `raw/` —— 原始资料层：采集产出的图文正文 / 视频字幕，是「事实来源」
- `wiki/` —— LLM 维护层：AI 从 raw 蒸馏出的概念 / 实体 / 主题 / 对比 / 概览页，带 `[[wikilink]]` 交叉引用，是问答助手的检索源

## 📁 项目结构

```
knowledge-vault/
├── client/                        # React + Vite 前端
│   └── src/
│       ├── components/
│       │   ├── Wiki/              #   文件浏览器 + Markdown 编辑器
│       │   ├── Collect/           #   导入面板
│       │   ├── Knowledge/         #   条目列表/卡片/详情
│       │   └── Layout/            #   Header/Sidebar
│       ├── pages/                 #   WikiPage/ImportPage/FilteredPage/RulesPage/QaPage
│       └── api/                   #   请求封装（含 SSE 流式助手）
├── server/
│   ├── src/
│   │   ├── index.js               #   入口：initDb → seed → initWiki → listen
│   │   ├── routes/                #   collect/knowledge/category/wiki/qa
│   │   ├── services/
│   │   │   ├── collector/         #   各平台适配器
│   │   │   ├── extractor.js       #   采集分治调度（视频/图文）
│   │   │   ├── extractor-article.js#   微信图文 HTTP 抓取
│   │   │   ├── url-utils.js       #   抖音短链解析
│   │   │   ├── classifier-ai.js    #   AI 内容分类
│   │   │   ├── filter.js          #   规则过滤引擎
│   │   │   ├── knowledge.js       #   CRUD + 指纹去重 + 统计
│   │   │   ├── linker.js         #   交叉链接实时计算
│   │   │   ├── fs-wiki.js        #   Markdown 文件系统服务（核心）
│   │   │   ├── reextract.js       #   重新提取历史条目
│   │   │   ├── distill.js         #   Wiki 蒸馏引擎
│   │   │   ├── qa.js              #   问答助手（两阶段渐进检索）
│   │   │   └── ai-client.js       #   共享 AI 客户端
│   │   ├── db/                    #   sql.js 初始化 + schema 迁移 + 种子数据
│   │   └── config/                #   分类层级 + 关键词库
│   ├── bin/                       #   yt-dlp.exe（需自备，见下文）
│   └── data/                      #   运行时生成（已 gitignore）
│       ├── knowledge.db
│       └── kb-wiki/
│           ├── AGENTS.md          #   给 AI 读的 Schema 层
│           ├── index.md           #   自动生成的导航
│           ├── raw/articles/      #   采集原文
│           └── wiki/              #   AI 蒸馏知识页
├── start.js                       # 一键启动（spawn 前后端）
└── agent.md                       # 项目规格书
```

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- Windows / macOS / Linux（已在 Windows 11 验证）
- **yt-dlp** 可执行文件（用于视频元数据/字幕提取，见下方配置）
- 一个**硅基流动 API Key**（免费注册：https://cloud.siliconflow.cn）

### 1. 克隆并安装依赖

```bash
git clone https://github.com/xlb1266/knowledge-vault.git
cd knowledge-vault
npm run install:all   # 安装根目录 + server + client 依赖
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`，填入你的 API key：

```env
SILICONFLOW_API_KEY=sk-你的key
AI_BASE_URL=https://api.siliconflow.cn/v1
AI_MODEL=Qwen/Qwen3-8B
# BILIBILI_COOKIE_FILE=  # 可选：放 Netscape 格式 cookie 才能提取 B站 CC 字幕
# YTDLP_PATH=            # 可选：自定义 yt-dlp 路径
```

> 没有配置 API key 也不会崩溃，分类会自动降级为关键词匹配模式。

### 3. 准备 yt-dlp（视频平台采集需要）

下载单文件版 yt-dlp，放到 `server/bin/yt-dlp.exe`，或设置 `YTDLP_PATH` 指向系统已安装的版本：

- Windows: https://github.com/yt-dlp/yt-dlp/releases/latest（下载 `yt-dlp.exe`）
- macOS/Linux: `pip install yt-dlp` 或 `brew install yt-dlp`

> 仅采集微信公众号图文不需要 yt-dlp。

### 4. 启动

```bash
# 方式一：一键启动前后端（无热重载）
npm run dev

# 方式二：分别启动（推荐开发，带热重载）
npm run dev:server    # 后端 http://localhost:3001
npm run dev:client    # 前端 http://localhost:5173
```

打开 http://localhost:5173 即可使用。

## 📖 使用流程

1. **导入收藏**：在「📥 采集导入」页粘贴链接（支持 B站/抖音/小红书/微信，抖音口令文本可直接粘贴）
2. **自动处理**：系统提取正文 → 过滤娱乐内容 → AI 分类 → 入库 + 生成 .md
3. **浏览知识库**：在「📁 知识库」用文件树浏览 / 编辑 / 删除 .md 文件
4. **蒸馏 Wiki**（可选）：点「🧪 蒸馏」让 AI 把 raw 原文加工成交叉链接的 wiki 知识页（SSE 流式进度，约 3-4 分钟）
5. **提问**：在「💬 问答助手」用自然语言提问，AI 检索 wiki 层流式作答并标注引用来源

## 🔌 API 概览

| 模块 | 端点示例 | 说明 |
|---|---|---|
| 采集 | `POST /api/collect/import` | 手动导入链接列表 |
| 知识库 | `GET /api/knowledge/entries?searchFull=true` | 分页列表（可扩展到正文全文检索） |
| 交叉链接 | `GET /api/knowledge/entries/:id/related` | 相关收藏 |
| 重新提取 | `POST /api/knowledge/entries/:id/reextract` | 重跑提取 + AI 分类 |
| 文件系统 | `GET /api/wiki/tree`、`POST /api/wiki/file` | .md 文件树读写 |
| Wiki 蒸馏 | `POST /api/wiki/distill`（SSE） | 流式蒸馏进度 |
| 问答 | `POST /api/qa/ask`（SSE） | 流式答题 + 引用 |

完整 API 与数据模型见 [agent.md](agent.md)。

## 🗺️ 路线图

- [x] 多平台采集 + 规则过滤 + SQLite 索引
- [x] AI 内容级分类（Qwen3-8B）
- [x] 采集分治（微信 HTTP / 抖音口令）
- [x] Markdown 文件系统 + 前端文件浏览器
- [x] 正文存储 / 指纹去重 / 交叉链接 / 分层检索
- [x] 提取修复 + description 渐进式检索字段
- [x] Wiki 蒸馏层 + 流式问答助手
- [ ] 嵌入向量检索（当前用 description 拼接预筛，上千条后需升级）
- [ ] 知识图谱可视化
- [ ] 蒸馏增量更新（当前全量重跑）
- [ ] 更多平台（知乎、少数派、GitHub Stars）

## 📚 文档

- [agent.md](agent.md) —— 项目规格书（数据模型、API、分类体系）

## ⚠️ 注意事项

- **不含用户数据**：本仓库不含数据库、kb-wiki 内容、API key 等运行时数据（见 `.gitignore`）。首次启动时 `initWiki()` 会自动重建 `kb-wiki/` 目录骨架。
- **AI 调用耗时**：Qwen3-8B 单次分类约 3 秒（已关闭推理模式 `enable_thinking: false`），蒸馏每页约 30-40 秒。
- **平台限制**：抖音无 cookie 时 yt-dlp 提取受限，会降级用标题喂 AI；B站 CC 字幕需提供 Netscape 格式 cookie 文件。
- **Windows 编码**：Git Bash 下用 curl 测试中文 API 必须用 `--data-binary @file.json`，`-d` 会破坏 UTF-8。

## 📝 License

暂未选择开源许可证。本项目为个人项目，如需复用代码请联系作者。
