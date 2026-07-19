# 方案 B 实施计划：内容级真分类改造

## 目标
把一期"标题关键词假分类"升级为"解析视频字幕+元数据 -> 喂 LLM 做内容级真分类"。
砍掉违法的 B站 API 逆向，改用 yt-dlp（spawn 子进程）+ DeepSeek（OpenAI 兼容）。

## 决策汇总（已与用户确认）
- 登录态：本地 cookie 文件（yt-dlp `--cookies`）
- AI 模型：DeepSeek-V3（OpenAI 兼容，¥1/百万输入），key 走环境变量
- 调用方式：Node 直接 spawn yt-dlp 子进程
- 超时：单条视频 45 秒，超时降级为只用标题+简介走关键词分类
- 旧数据：清空重来（删 knowledge.db）
- 兜底：AI 调用失败/未配置 key 时，降级为旧关键词分类器

## 环境准备（动手前）
1. 下载 yt-dlp.exe（Windows 单文件版）放 `server/bin/yt-dlp.exe`
   - 从 https://github.com/yt-dlp/yt-dlp/releases 拉最新版
2. 后端装 `openai` 包（OpenAI 兼容 SDK，同时支持 DeepSeek/通义/Claude）
3. 创建 `server/.env`：`DEEPSEEK_API_KEY=`、`AI_BASE_URL=`、`AI_MODEL=`、`AI_ENABLED=`
4. 删除 `server/data/knowledge.db`（清空旧数据）

## 代码改动

### 新增文件

**`server/src/services/extractor.js`** — yt-dlp 封装
- `extractVideo(url, { cookieFile })` -> 返回 `{ title, author, description, thumbnail, subtitleText, duration }`
- spawn yt-dlp 参数：`--skip-download --dump-json --write-subs --sub-format srt --sub-lang zh-Hans,zh,zh-CN,en -o tempdir/%(id)s`
- 带 `--cookies cookie.txt` 当 cookie 文件存在时
- 45 秒超时，超时 kill 子进程，返回已得元数据（字幕可能为空）
- 读取生成的 .srt 文件，解析成纯文本（去时间轴）
- 清理临时文件
- yt-dlp.exe 路径：优先 `YTDLP_PATH` 环境变量，否则 `server/bin/yt-dlp.exe`

**`server/src/services/classifier-ai.js`** — LLM 分类器
- `classifyByAI(item)` -> `{ category_l1, category_l2, category_l3, summary, tags, is_valid, filter_reason }`
- 输入：title + author + description + subtitleText（字幕截断到前 6000 字符控成本）
- prompt 设计：给 LLM 完整分类树（从 config/categories.js 取），让它返回 JSON
  - system：你是知识库分类器，只能从给定分类树选，判断是否有效知识
  - user：视频信息 + 分类树 + "返回 {l1,l2,l3,summary,tags[],is_valid,reason}"
- 用 OpenAI SDK，`baseURL` 从环境变量取（默认 DeepSeek）
- 解析 LLM 返回的 JSON，校验分类是否在树内
- 失败（超时/格式错/key 缺失）抛错，由上层降级到关键词分类器

**`server/bin/.gitkeep`** — 放置 yt-dlp.exe 的目录占位

**`server/.env.example`** — 环境变量模板

### 修改文件

**`server/src/services/collector/bilibili.js`** — 砍掉逆向 API
- 删掉 `collect()` 里调 `api.bilibili.com` 的整段逻辑
- `collect()` 改为返回空数组（手动导入走 normalize，不靠 API 拉列表）
- 保留 `normalize()`
- 文件头注释说明：B站内容解析改由 extractor + AI 完成

**`server/src/routes/collect.js`** — 串新流程
- 改 `/import` 流程：normalize 后，对每条 item：
  1. 调 `extractVideo(url)` 提取元数据+字幕（失败则只用原 title/summary）
  2. 用提取到的信息更新 item（title/author/description 补全）
  3. 过滤引擎 `filterItems`（保留，exclude 排除娱乐内容）
  4. 若 `AI_ENABLED`：调 `classifyByAI` 做内容级分类；失败/未启用则降级 `classifyItems`（关键词）
  5. `batchUpsert` 存储
- 删除 `/bilibili` 这个 cookie API 端点（已违法，不再支持）
- 批量导入改为串行逐条提取（避免 yt-dlp 并发被风控），每条间 1-2 秒间隔
- 进度反馈：长任务，前端轮询或 SSE（一期先用同步等待，导入结果统计返回）

**`server/src/services/collector/index.js`** — 简化
- 删掉对已废弃 cookie API 的兜底分支
- 只保留 links / csvData 两条路径

**`server/src/index.js`** — 加载环境变量
- 顶部 `require('dotenv').config()`（需装 dotenv）

**`server/package.json`** — 加依赖
- `openai`、`dotenv`

### 前端微调

**`client/src/components/Collect/ImportPanel.jsx`**
- 删掉 B站 Cookie 拉取 tab（已不支持）
- 手动导入 textarea 的格式说明更新：只需 `URL|标题`，标题可空（yt-dlp 会自动提取）
- 导入时显示"正在解析视频内容..."提示（耗时变长）

**`client/src/components/Knowledge/EntryDetail.jsx`**
- 详情面板新增"内容摘要"区（已有 summary 字段，确保突出展示 AI 生成的摘要）
- 新增"AI 标签"展示（tags 字段已有）

## 数据库
- 表结构不变（knowledge_entries 已有 summary/tags/分类字段）
- 仅清空数据：删 `server/data/knowledge.db`，重启自动重建+种子规则

## 验证流程
1. 确认 yt-dlp.exe 在 `server/bin/` 可执行
2. 启动后端，检查 `.env` 是否加载
3. 准备一个 B站知识类视频链接（如 Python 教程）
4. 前端导入单条，验证：
   - yt-dlp 提取到完整 title/author/description
   - 字幕提取成功（需 cookie）或失败降级
   - AI 返回分类 + 摘要 + 标签
   - 存库后详情面板能看到 AI 摘要
5. 导入一个娱乐视频，验证被 filter 排除
6. 测试超时降级：用一个很慢/不存在的链接

## 风险与兜底
- yt-dlp 被风控/版本失效：报错降级为只用提交的 title
- AI key 未配置：自动降级关键词分类器，系统可用
- 字幕不存在：只用 title+description 喂 AI，分类精度略降但仍优于纯关键词
- 成本失控：字幕截断 6000 字符，单条约 ¥0.006

## 待用户准备
- DeepSeek API key（去 platform.deepseek.com 注册）
- B站 cookie 文件（可选，浏览器导出 Netscape 格式 .txt 放 `server/data/bilibili-cookie.txt`）
