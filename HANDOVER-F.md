# 方案F 交接文档：Wiki 蒸馏层 + 问答助手

> 创建：2026-07-16
> 范围：在方案D/E（Markdown 文件系统 + description）之上，新增「raw 原文 → AI 蒸馏成交叉链接 wiki 知识页」和「问答助手检索 wiki 层流式答题」两条链路。
> 与总交接 [HANDOVER.md](HANDOVER.md) 的关系：本文件聚焦方案F 新增内容，项目全貌/启动/配置/历史陷阱以 HANDOVER.md 为准。

---

## 一、为什么这样做（背景与决策）

### 1. 核心方法论：Obsidian / Karpathy LLM-wiki

`kb-wiki/raw/` 下是**未加工**的采集原文（图文正文、视频简介+字幕）。问答助手**不能直接拿 raw 当参考材料**——那是未加工的素材，信息零散、重复、无结构。

正确做法是先把 raw **蒸馏**成 wiki 知识页：

- raw（未加工源）→ AI 按 [AGENTS.md](server/data/kb-wiki/AGENTS.md) 规则加工 → wiki（交叉链接知识页）
- wiki 页之间用 `[[wikilink]]` 互相引用，形成知识网络
- 蒸馏后的页**仍保留 description 字段**，供问答助手渐进式预筛

这套「LLM 把笔记蒸馏成交叉链接 wiki」的方法论原创者是 Andrej Karpathy（Obsidian 社区广为流传）。

> ⚠️ 实施时的诚实记录：Karpathy 原始出处未能通过联网检索（WebSearch 为美国区，多组查询无命中）找到一手链接，故**未杜撰来源 URL**，蒸馏规则直接采用项目既有的 `kb-wiki/AGENTS.md`。如后续找到一手资料，对照修订 AGENTS.md 即可。

### 2. 检索规则（用户明确指定，两阶段渐进式）

> 预筛：拉所有有效条目的 description，AI 选出与问题相关的条目 id。
> 答题：只读相关条目的 content_text 正文，AI 流式组织答案，标注引用来源。

落到本方案：预筛扫的是 **wiki 页的 description**（不是 raw），正文读的是 **wiki 页正文**。这样答的是「已加工、已交叉链接」的知识，而非零散原文。

### 3. 用户的关键纠正（务必记住）

最初方案让问答助手直接检索 raw/articles，**被用户明确否决**。原话要点：
- raw 是未加工文档，必须先 AI 加工放 wiki；
- 加工后的知识要互相关联（[[wikilink]] 交叉链接）；
- 加工后仍保留 description 字段；
- 问答助手检索 wiki 层（两阶段：预筛 description → 读正文 → 流式答题 + 引用）。

**接手人切勿回退到「检索 raw」的方案。**

---

## 二、架构与数据流

```
kb-wiki/raw/articles/*.md  （方案D/E 已有的未加工原文，7 条）
                │
                │  ① distillAll()  手动触发（前端🧪按钮 / POST /api/wiki/distill）
                ▼
        ┌──────────────────────────────────────┐
        │ distill.js 蒸馏引擎                  │
        │  planWikiPages  AI 规划页清单        │
        │  clearAIPages   清掉旧 ai_generated 页 │
        │  synthesizePage AI 合成每页正文+描述 │
        │  sanitizeLinks 断链降级为纯文本      │
        │  lintLinks      统计断链              │
        │  writeWikiPage  写 wiki/{type}/*.md  │
        └──────────────────────────────────────┘
                │
                ▼
kb-wiki/wiki/{entities,concepts,topics,comparisons,overviews}/*.md
   （本次产出 8 页，全在 topics/，20 处 [[交叉链接]]，0 断链）
   每页 frontmatter 含：type/title/description/source_ids/related/ai_generated/distilled_at
                │
                │  ② answerQuestionStream()  POST /api/qa/ask (SSE)
                ▼
        ┌──────────────────────────────────────┐
        │ qa.js 问答助手                       │
        │  scanWikiPages   扫 wiki 页+解析fm   │
        │  selectRelevant  AI 按 description 预筛 │
        │  buildAnswerMessages 拼系统提示+历史   │
        │  → 流式 delta + 引用卡片             │
        └──────────────────────────────────────┘
                │
                ▼
        前端 QaPage.jsx（聊天 UI，逐字流式 + [1][2]引用卡点击跳转 wiki 文件）
```

两条链路**解耦**：蒸馏是一次性批处理（3-4 分钟），问答是实时流式。问答依赖 wiki 层存在——空库时前端会引导先蒸馏。

---

## 三、文件清单

### 新增文件

| 文件 | 职责 |
|---|---|
| [server/src/services/ai-client.js](server/src/services/ai-client.js) | AI client 共享模块，distill/qa 复用；读相同 env，独立 init，**不碰 classifier-ai.js**（零回归） |
| [server/src/services/distill.js](server/src/services/distill.js) | Wiki 蒸馏引擎，导出 `distillAll(onProgress)` |
| [server/src/services/qa.js](server/src/services/qa.js) | 问答助手，导出 `answerQuestionStream(question, history, onEvent)` |
| [server/src/routes/qa.js](server/src/routes/qa.js) | SSE 路由 `POST /api/qa/ask` |
| [client/src/pages/QaPage.jsx](client/src/pages/QaPage.jsx) | 聊天界面，SSE 逐字 + 引用卡 + 跳转 |
| [PLAN-F.md](PLAN-F.md) | 本阶段计划书 |

### 修改文件

| 文件 | 改动 |
|---|---|
| [server/src/services/fs-wiki.js](server/src/services/fs-wiki.js) | 新增并导出 `parseFullFrontmatter`（蒸馏/qa 复用的完整 frontmatter 解析）；`AGENTS_MD_CONTENT` 常量补 wiki 页 schema |
| [server/src/routes/wiki.js](server/src/routes/wiki.js) | 加 `POST /api/wiki/distill`（SSE 进度）；同步用 `res.on('close')` |
| [server/src/index.js](server/src/index.js) | 挂载 `app.use('/api/qa', qaRoutes)` |
| [client/src/api/index.js](client/src/api/index.js) | 加 `streamSSE(url, body, onEvent)` 通用助手；`wikiApi.distill`、`qaApi.ask` |
| [client/src/components/Layout/Sidebar.jsx](client/src/components/Layout/Sidebar.jsx) | 导航加「💬 问答助手」 |
| [client/src/App.jsx](client/src/App.jsx) | `pendingWikiPath` 状态 + `handleOpenWikiPage`（问答引用卡→打开 wiki 文件）+ `case 'qa'` |
| [client/src/pages/WikiPage.jsx](client/src/pages/WikiPage.jsx) / [FileExplorer.jsx](client/src/components/Wiki/FileExplorer.jsx) | FileExplorer 接受 `pendingWikiPath` 自动打开；加🧪蒸馏按钮 + SSE 进度 |
| [client/src/styles/index.css](client/src/styles/index.css) | `.qa-page` / `.qa-msg` / `.qa-citation` / `.qa-spinner` / `.fe-progress` |
| [server/data/kb-wiki/AGENTS.md](server/data/kb-wiki/AGENTS.md) | 补 wiki 页 frontmatter schema + 问答检索说明 |

---

## 四、蒸馏引擎细节（distill.js）

### 关键常量
```js
const WIKI_TYPES = ['entities', 'concepts', 'topics', 'comparisons', 'overviews'];
const TYPE_DEFAULT = 'topics';
const MAX_PER_SOURCE = 3000;       // 单条 raw 正文截断
const MAX_SOURCES_PER_PAGE = 4;    // 单个 wiki 页最多引用的 raw 条目
```

### distillAll(onProgress) 主流程
1. 从 DB 拉 raw 条目（`all`/`get`，取有正文的）
2. `planWikiPages(entries)` —— AI 返回 JSON 数组 `[{type,title,source_ids,related,purpose}]`（一次规划全部页清单）
3. `clearAIPages()` —— 删掉旧 wiki 中 `ai_generated:true` 的页（**只删 AI 页，手动页保留**）
4. 逐页 `synthesizePage(page, sourceEntries, allTitles)` —— AI 返回 `{content, description}`，**只允许 link 到 allTitles 集合内的标题**
5. `sanitizeLinks(content, titleSet)` —— 把不在标题集的 `[[x]]` 降级为纯文本 `x`
6. `writeWikiPage` —— 写 `wiki/{type}/{filename}.md`，带 frontmatter
7. `lintLinks` —— 统计断链（应为 0）
8. 全程通过 `onProgress(event)` 上报 SSE 进度

### 断链处理（重要）
```js
content.replace(/\[\[([^\]]+)\]\]/g, (full, target) =>
  titleSet.has(target.trim()) ? full : target.trim()
);
```
AI 合成时可能凭空造出 `[[不存在的标题]]`，这里强制降级为纯文本。实测修复了「人体姿态骨架」这类断链，最终 0 断链。

### 重蒸馏语义
`clearAIPages` 只删 `ai_generated:true` 的页。手动新建的 wiki 页（无该标记或 `ai_generated:false`）**不会被覆盖**。这意味着人工补充的知识页在重蒸馏后保留。

### 进度上报
`onProgress` 回调发 SSE 事件，前端显示「合成 LangChain(3/8)...」。10 页约 3-4 分钟（每页生成 ~1500 token 正文，30-40s）。

---

## 五、问答助手细节（qa.js）

### 关键常量
```js
const MAX_PAGES = 5;          // 答题最多引用的 wiki 页
const MAX_PAGE_CHARS = 3000; // 单页正文截断
const HISTORY_TURNS = 4;     // 保留最近几轮对话
```

### answerQuestionStream(question, history, onEvent) 主流程
1. `scanWikiPages()` —— 读 `wiki/{五类}/*.md`，`parseFullFrontmatter` 解析，返回 `{title,description,type,source_ids,related,path,raw}[]`
2. `selectRelevant(question, pages)` —— AI 拿所有页的 `description` 预筛，返回相关标题字符串数组
3. **模糊匹配 + 兜底**（关键）：
   ```js
   const relevant = relevantTitles
     .map((t) => pages.find((p) =>
       p.title === t || p.title.includes(t) || t.includes(p.title)))
     .filter(Boolean)
     .slice(0, MAX_PAGES);
   if (!relevant.length) {
     relevant.push(...pages.slice(0, MAX_PAGES)); // 兜底
   }
   ```
4. 发 `citations` 事件（引用卡列表）
5. `buildAnswerMessages` —— 系统提示约束「只能用参考资料 + `[1][2]` 引用」，历史截最近 4 轮
6. 流式调 AI，逐 chunk 发 `delta` 事件
7. 完成发 `done`

### 引用编号
参考资料按顺序编号 `[1][2][3]...`，对应 citations 卡片。前端卡片点击 → `onOpenWikiPage(path)` → 跳转文件浏览器打开该 wiki 文件。

---

## 六、Wiki 页 frontmatter schema

实际产物示例（[wiki/topics/Codex.md](server/data/kb-wiki/wiki/topics/Codex.md)）：

```markdown
---
type: topics
title: Codex
description: Codex 功能与使用方法，AI剪辑，职场效率，视频上下文理解，提示词优化，画面控制
source_ids: [1, 5]
related: ["Kimi Code", "提示词优化"]
ai_generated: true
distilled_at: 2026-07-16T14:29:59.025Z
---

# Codex

正文...含 [[Kimi Code]] [[提示词优化]] [[LangChain框架应用]] 等交叉链接
```

字段说明：
| 字段 | 类型 | 用途 |
|---|---|---|
| type | string | 五类之一：entities/concepts/topics/comparisons/overviews |
| title | string | 页标题，也是 `[[wikilink]]` 的目标 |
| description | string | 关键词式，**问答预筛的唯一依据**（不读正文先看它） |
| source_ids | number[] | 追溯到 raw 条目的 DB id，可反查原文 |
| related | string[] | 相关页标题（也是 wikilink 目标） |
| ai_generated | bool | true=AI 蒸馏页（重蒸馏会清掉）；false/缺省=手动页（保留） |
| distilled_at | ISO | 蒸馏时间戳 |

---

## 七、API 端点

### 蒸馏
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/wiki/distill` | raw → wiki，**SSE 流式**。body 空。事件见下 |

蒸馏 SSE 事件：`status`（阶段） / `progress`（合成第 N/M 页） / `done`（含页数/链接数/断链数） / `error`

### 问答
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/qa/ask` | SSE 流式问答。body `{question, history}` |

问答 SSE 事件：
| 事件 | payload | 含义 |
|---|---|---|
| `status` | `{message}` | 阶段提示（扫描 wiki / 预筛 / 生成） |
| `citations` | `{citations:[{title,type,path}...]}` | 引用卡片，前端渲染可点击 |
| `delta` | `{text}` | 逐字答案片段 |
| `done` | `{}` | 完成 |
| `error` | `{message}` | 出错 |

---

## 八、验证方式

### 1. 蒸馏（curl，注意超时）
```bash
# 耗时 3-4 分钟，curl 默认超时不够，加 --max-time 或直接看前端
curl -N -X POST http://localhost:3001/api/wiki/distill
# 期望：流式输出多行 data: {...}，最终 done 含 pages:8 links:20 brokenLinks:0
```

### 2. 蒸馏产物检查
```bash
ls server/data/kb-wiki/wiki/topics/   # 8 个 .md
grep -rho "\[\[[^]]*\]\]" server/data/kb-wiki/wiki | wc -l   # 20 处交叉链接
```

### 3. 问答（curl SSE）
```bash
# Windows Git Bash 中文须用 --data-binary @file.json，避免乱码
cat > /tmp/q.json <<'EOF'
{"question":"Codex 是什么？能做什么","history":[]}
EOF
curl -N -X POST http://localhost:3001/api/qa/ask \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/q.json
# 期望：先 citations（5 张卡），再逐 delta，最后 done
```

### 4. 浏览器端到端
1. 前端 http://localhost:5173 → 「💬 问答助手」
2. 问「Codex 是什么？」→ 看到逐字流出 + 5 张引用卡 + `[1]` 标注
3. 点引用卡 → 跳转「📁 知识库」并自动打开对应 wiki 文件
4. 多轮追问（如「它和 Kimi Code 比呢？」）→ 仍带引用、答在点上
5. 「📁 知识库」点🧪蒸馏 → 看到进度行「合成 xxx(N/8)」

---

## 九、陷阱（方案F 专属）

### 1. SSE 必须用 `res.on('close')`，不是 `req.on('close')` ★最隐蔽
Node 24 / Express 5 下，`req.on('close')` 在**请求体读完后立即触发**（并非客户端真正断开），会误判中止、把 `aborted=true`，导致后续所有 `send()` 被跳过——客户端只收到第一个事件。

```js
// ✅ 正确：响应连接关闭才是真断开
let aborted = false;
res.on('close', () => { aborted = true; });
const send = (type, payload) => {
  if (aborted) return;
  res.write(`data: ${JSON.stringify({ type, ...(payload || {}) })}\n\n`);
};
```

`distill` 和 `qa` 两个 SSE 路由都用这个写法。详见 [routes/qa.js](server/src/routes/qa.js)、[routes/wiki.js](server/src/routes/wiki.js)。

### 2. Map 构造陷阱（已修复，记录防复发）
早期写过 `new Map(pages.map(p => p.title))` —— **错**。Map 构造要 `[key,value]` 对，传字符串数组会抛 `Iterator value xxx is not an entry object`。async 函数里的抛出变成 rejected promise 被静默吞掉。现已改用 `pages.find()` 模糊匹配。

### 3. 预筛标题模糊匹配 + 兜底
AI 预筛返回的标题可能与实际 wiki 标题不精确一致（如返回「LangChain框架应用」实际是「LangChain」）。用 `includes` 双向模糊匹配；若全部落空则兜底取前 `MAX_PAGES` 页，**保证始终有素材可答**，避免多轮追问无引用。

### 4. 蒸馏耗时
1 次规划 + N 次合成，每次 ~30-40s。8-10 页约 3-4 分钟。前端必须用 SSE 流式进度，否则盲等像卡死。蒸馏是**手动触发**，不在采集流程里自动跑。

### 5. ai-client.js 独立于 classifier-ai.js
为避免动已验证的分类逻辑引入回归，新开 `ai-client.js` 给 distill/qa 用，读相同 env 但独立 init。两者未来可统一收敛，但当前保持分离。

### 6. 当前数据偏 topics 型
本次 8 个 wiki 页全在 `wiki/topics/`，其余四类目录（entities/concepts/comparisons/overviews）为空——数据集本身就是主题型内容。**不是 bug**，是 AI 规划按内容性质归类。数据更丰富后其他目录会自然出现。

### 7. Windows Git Bash curl 中文
测中文问答务必 `--data-binary @file.json`，否则 UTF-8 被破坏。浏览器 fetch 不受影响。

---

## 十、后续规划（未实现，勿擅自动工）

- **嵌入向量检索**：当前 description 拼接预筛，库大到上千条后需换向量检索（distill.js/qa.js 已预留常量，改造点在 `selectRelevant`）
- 知识图谱可视化（基于 `related` + `[[wikilink]]` 画关系图）
- 蒸馏增量更新（当前每次重跑全量，可改为只处理新增 raw）
- 更多平台采集（知乎、少数派、GitHub Stars）
- 找到 Karpathy LLM-wiki 一手出处后对照修订 AGENTS.md 蒸馏规则

---

## 十一、接手第一步

1. 读 [HANDOVER.md](HANDOVER.md) 第二~七节确认项目全貌与启动方式
2. `node --watch server/src/index.js` + 前端 `npx vite --host`
3. 跑第八节验证清单（蒸馏 curl / 问答 curl / 浏览器端到端）
4. 确认 `wiki/topics/` 有 8 页、20 链接、0 断链
5. 任何改动前先看本文件第九节陷阱，尤其 **res.on('close')**
