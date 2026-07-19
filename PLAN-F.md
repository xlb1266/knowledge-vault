# PLAN-F：Wiki 蒸馏层（raw→交叉链接知识页）+ 问答助手（检索 wiki 层）

> 纠正 PLAN-F 初版误区：**不能直接用 raw/articles 原文做问答助手素材**。
> 正确路径遵循 Obsidian/Karpathy 的 LLM-wiki 方法论（规则已内置在 AGENTS.md）：
> raw 是未加工原文 -> AI 按 AGENTS.md 的 `distill` 规则蒸馏成交互链接的 wiki 知识页 -> 问答助手检索 wiki 层。
> 分两阶段交付：**A 蒸馏层**（前提）→ **B 问答助手**（检索 wiki 层）。

---

## 一、为什么不能直接检索 raw

| 层 | 性质 | 能否直接问答 |
|---|---|---|
| raw/articles | 未加工原文（视频简介+字幕 / 公众号正文），碎片、重复、噪声多 | ❌ 答案会是原文堆砌，无提炼、无关联 |
| wiki/ | AI 蒸馏后的知识页（概念/实体/主题），含 [[wikilink]] 交叉链接、带 description | ✅ 加工过的知识，结构化、互相关联 |

PLAN-E 的 description 字段、AGENTS.md 的 wiki 层职责，都是为"蒸馏 + 检索加工后知识"铺的路。问答助手必须读 wiki 层。

---

## 二、AGENTS.md 已定义的规则（实现依据）

wiki/ 五类目录（已有骨架）：
```
wiki/
├── entities/    人物、工具、项目、组织
├── concepts/    技术概念、术语
├── topics/      主题综合页
├── comparisons/ 对比分析
└── overviews/   高层概览
```

AGENTS.md `AI 维护指南` 原文：
- **distill**：从多个 raw 页提炼共性 -> 写入 wiki/concepts/ 或 wiki/topics/，用 `[[wikilink]]` 交叉引用
- **lint**：检查断链、孤立页、过期内容

本方案即落地这两条 + 给 wiki 页加 description（PLAN-E 同款渐进式检索字段）。

---

## 三、阶段 A：Wiki 蒸馏引擎

### 3.1 设计要点
- **不是 1:1 搬运**：多条 raw 汇聚成一个概念页（如多个 Codex 条目 → 一个 `Codex` concept 页）；独立但重要的主题也单独成页。
- **交叉链接**：wiki 页正文用 `[[概念名]]` 标记，指向其他 wiki 页标题。蒸馏前已确定全部页标题清单，合成时只 link 清单内标题 -> **无断链**。
- **保留 description**：每个 wiki 页 frontmatter 带 description（主题+3-6关键词+适用场景），供阶段B预筛。
- **覆盖/重生成**：蒸馏只管理 AI 生成的页（frontmatter 标 `ai_generated: true`）。重蒸馏时先删带此标记的旧页再重写，用户手动页（无标记）保留。

### 3.2 wiki 页 Frontmatter Schema
```yaml
---
type: concept                     # concept/entity/topic/comparison/overview
title: LangChain
description: "主题+3-6关键词+适用查询场景，50-100字"   # ★ 渐进式检索字段，保留
source_ids: [3, 7]                # 关联的 raw 条目 id（追溯原文）
related: ["LangGraph", "RAG"]      # 交叉链接（wiki 页标题）
ai_generated: true                # 蒸馏产物标记（区分手动页，重生成时只删这种）
distilled_at: 2026-07-16T12:00:00Z
---

# LangChain

蒸馏正文……涉及 [[LangGraph]] 与 [[RAG]] 时用双方括号标记……
```

### 3.3 新建 `server/src/services/distill.js`（核心）

**AI client**：参照 classifier-ai.js，独立初始化 OpenAI 兼容 client（同环境变量），不改 classifier-ai.js。

**主流程 `distillAll()`**：
```
1. 拉所有有效 raw 条目（id,title,description,content_text,category,tags,source_platform）
2. [规划] AI 看所有条目 title+description+tags+category
   -> 产出 wiki 页清单 JSON：[{type, title, source_ids:[], related:[], purpose}]
   规则：跨条目提炼共性、独立主题单列、related 只引用清单内标题
3. 清空 AI 旧页：删 wiki/{五类}/*.md 中 frontmatter ai_generated=true 的（保留手动页）
4. [合成] 对清单每个页：
   - 取 source_ids 对应 raw 的正文（每条≤3000字，总≤4条）
   - AI 合成蒸馏正文 + description，正文内 [[link]] 只用清单内标题
   - 写 wiki/{type}/{清理后标题}.md
5. [lint] 检查所有 [[link]] 能否在页标题集合命中，断链记 log.md
6. updateIndex（复用 fs-wiki）+ appendLog
返回 {pagesGenerated, links, brokenLinks}
```

**规划 prompt**（阶段1，输出页清单）：
```
你是知识库蒸馏引擎。下面是 raw 层所有条目（编号、标题、分类、标签、检索描述）。
规划 wiki 层知识页清单：
1. 从多条 raw 提炼共性概念/实体/主题，不要 1:1 搬运
2. 每页指定 type（concept/entity/topic/comparison/overview）
3. source_ids 引用相关 raw 编号
4. related 用 [["标题"]] 标注关联页，只能引用本清单内将出现的标题
5. 独立但重要的主题也单列
返回 JSON：[{"type":"concept","title":"LangChain","source_ids":[3,7],"related":["LangGraph","RAG"],"purpose":"一句话"}]
条目清单：
<编号 标题 | 分类 | 标签 | description>
```

**合成 prompt**（阶段2，每页）：
```
你是知识库蒸馏引擎。为知识页「{title}」（类型 {type}）合成蒸馏内容。
参考资料（raw 条目）：
<{id} {title}\n来源：{platform}\n正文：{content截断}>
要求：
1. 综合提炼结构化知识，不是搬运原文
2. 文中涉及其他知识点用 [[概念名]] 标记，只能用以下已有标题：{清单标题列表}
3. 生成 description（主题+3-6关键词+适用查询场景，50-100字）
4. markdown 组织（标题/列表）
返回 JSON：{"content":"# {title}\n...","description":"..."}
```

### 3.4 API + 前端
- `routes/wiki.js` 加 `POST /api/wiki/distill`（调 `distillAll()`，返回生成统计）
- `api/index.js` `wikiApi.distill()`
- FileExplorer 工具栏加「🧪 蒸馏知识库」按钮（带确认提示：会多次调 AI，较慢，约 N×3s）
- 蒸馏后文件树 wiki/ 下出现 concept/entity 等页，可点击查看（复用现有 markdown 编辑/预览）

### 3.5 路径安全
蒸馏写 wiki/{type}/ 路径，复用 fs-wiki 的 `assertSafePath`。文件名用标题清理（同 raw 的清理逻辑），冲突加 hash。

---

## 四、阶段 B：问答助手（检索 wiki 层）

### 4.1 与初版的关键差异
| 维度 | 初版（错） | 修正版 |
|---|---|---|
| 预筛对象 | raw 条目 description | **wiki 页 description** |
| 答题素材 | raw 条目 content_text 原文 | **wiki 页蒸馏正文 + 交叉链接上下文** |
| 引用来源 | raw 条目卡片 | wiki 页卡片（可追溯 source_ids 到 raw） |

若 wiki 层为空（未蒸馏），引导用户先蒸馏。

### 4.2 新建 `server/src/services/qa.js`
**`answerQuestionStream(question, history, onEvent)`**：
```
1. 扫 wiki/{五类}/*.md，解析 frontmatter（title, description, type, source_ids, related, md路径）
   空则 onEvent('error', 引导蒸馏) return
2. [预筛] onEvent('status','检索中')
   AI 看 {title, description} 清单 + 问题 -> 返回相关 wiki 页标题数组（≤5）
   兜底：空/异常取全部（库小可行）
3. 读相关 wiki 页正文 + 顺 related 扩展1跳（可选，控量）
4. onEvent('citations', 来源卡片含 wiki 页 path + source_ids)
5. [答题] onEvent('status','组织答案')
   stream:true 逐字，system 限定只用参考资料、引用 [1][2]、不编造
   user：编号 wiki 页正文 + history(最近4轮) + 问题
6. onEvent('done')
```
- Qwen3 `enable_thinking:false`（同 classifier-ai）
- 正文截断 wiki 页≤3000字、≤5页

### 4.3 SSE 路由 `routes/qa.js`（同初版）
`POST /api/qa/ask`，`text/event-stream`，事件：status / citations / delta / done / error。`req.on('close')` 处理客户端断开。

### 4.4 前端 `QaPage.jsx`（同初版，引用卡跳 wiki 页）
- fetch ReadableStream 解析 SSE
- 助手气泡：react-markdown 渲染答案 + 下方引用来源卡片
- 卡片点击 -> `onOpenWikiPage(path)` -> App 切到 wiki + FileExplorer 打开该 wiki 页
- 多轮：前端传最近4轮 history
- 空库/未蒸馏：error 事件引导「先去知识库点蒸馏」

### 4.5 导航接入
Sidebar 加「💬 问答助手」；App 加 case + `pendingWikiPath` 跳转透传。

---

## 五、实施顺序

**阶段 A（蒸馏，前提）**
1. `services/distill.js`：client + distillAll + 规划/合成 prompt + lint
2. `routes/wiki.js` 加 `/distill`
3. 前端 wikiApi.distill + FileExplorer 按钮
4. curl 触发蒸馏 -> 验证 wiki/{五类} 生成带 [[link]] + description 的页、无断链

**阶段 B（问答，检索 wiki）**
5. `services/qa.js`：扫 wiki frontmatter + 预筛 + 流式答题
6. `routes/qa.js` SSE
7. index.js 挂 /api/qa
8. curl 验证 SSE 事件流（status->citations->delta->done）
9. 前端 qaApi.ask + QaPage + 引用跳转
10. Sidebar/App 导航接入
11. 浏览器端到端：先蒸馏 -> 提问 -> 答案逐字流 + 引用卡跳转

---

## 六、验证点

**阶段 A**
- 蒸馏后 wiki/concepts 等出现页，frontmatter 含 type/description/source_ids/related/ai_generated
- 多条同主题 raw 汇聚成一页（如 Codex 相关条目合一）
- 正文 [[link]] 全部能命中某 wiki 页标题（lint 无断链）
- 重蒸馏不生成重复页（删旧 AI 页再写），手动页保留
- description 非空

**阶段 B**
- 提问「LangChain 能做什么」-> 预筛命中 LangChain wiki 页 -> 答案基于蒸馏知识，引用 [1]
- 答案逐字流式
- 多轮追问生效
- 引用卡点击跳转 wiki 页
- 无相关知识 -> 明确说不编造
- wiki 层空 -> 引导先蒸馏
- AI 不可用 -> 友好报错
- 关页面 -> 后端不崩

---

## 七、风险与边界

| 项 | 处理 |
|---|---|
| 蒸馏调 AI 多（1规划+N合成） | 7条数据约 1+5 次调用，可接受；前端 loading+耗时提示 |
| 数据少时汇聚效果有限 | 机制正确即可，单条独立主题可单列成页 |
| [[link]] 断链 | 规划阶段定全标题，合成只 link 清单内；蒸馏后 lint 兜底 |
| wiki 页覆盖丢手动页 | ai_generated 标记区分，重生成只删 AI 页 |
| 库大后预筛不准 | 当前 description 拼接预筛数百条可行；上千条换嵌入向量（预留） |
| 蒸馏质量依赖 AI | prompt 约束格式，可后续 lint description 规范性 |
| related 扩展1跳控量 | 仅可选，默认关或限2条 |

---

## 八、交付物

**阶段 A**
- `server/src/services/distill.js`（新）
- `server/src/routes/wiki.js`（加 /distill）
- `client/src/api/index.js`（wikiApi.distill）
- `client/src/components/Wiki/FileExplorer.jsx`（蒸馏按钮）

**阶段 B**
- `server/src/services/qa.js`（新）
- `server/src/routes/qa.js`（新）
- `server/src/index.js`（挂 /api/qa）
- `client/src/api/index.js`（qaApi）
- `client/src/pages/QaPage.jsx`（新）
- `client/src/components/Layout/Sidebar.jsx`（导航项）
- `client/src/App.jsx`（case + pendingWikiPath）
- `client/src/pages/WikiPage.jsx` + `FileExplorer.jsx`（跳转透传）
- `client/src/styles/index.css`（聊天样式）

**文档**
- `PLAN-F.md`（本文件）
- 更新 `HANDOVER.md`、`kb-wiki/AGENTS.md`（补 wiki frontmatter type/description 细则）
- 写记忆 `knowledge-vault-wiki-distill-qa`

---

## 九、关于 Karpathy 方法论

用户提示原创者为 Andrej Karpathy。我已用 WebSearch 多组关键词检索，但因 WebSearch 为 US-only 且对此小众出处覆盖有限，未拿到确切原文/项目链接。本方案不依赖该具体出处——AGENTS.md 已内置等效规则（distill + wikilink + lint），实现以此为准。若用户有具体链接可补充，我据此对齐细节。
