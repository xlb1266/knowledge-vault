# PLAN-E：内容提取修复 + description 渐进式检索字段

> 修复各平台正文提取（B站/小红书/抖音漏取简介），并给每个 .md 生成 description 字段（含关键词），
> 供未来问答助手做"先扫 description 预筛、命中再读正文"的渐进式加载（参考 SKILL 设计）

---

## 一、问题诊断（已实测）

| 平台 | yt-dlp 实际拿到 | md 正文现状 | 根因 |
|---|---|---|---|
| B站 | description(简介) + 无字幕(无cookie) | 「暂无正文内容」 | 代码只取字幕当正文，简介漏了 |
| 小红书 | description(笔记正文223字) | 「暂无正文内容」 | 同上，笔记正文在 description 里没取 |
| 抖音 | 同 B站机制 | 同上 | 同上 |
| 微信 | contentText(正文) ✓ | id:11空，id:19有 | 历史数据没存，现在能抓到 |

**核心 bug**：`extractor.js` 的 `extractContent` 对视频平台 `contentText = video.subtitleText`，只取字幕，把 `description`（简介/笔记正文）漏了。而多数视频无 CC 字幕（需 cookie），但有 description。

---

## 二、用户决策（已确认）

1. 重新提取时**重跑 AI**，且不只是分类，要**生成 description 字段**（含关键词）
2. description 参考 SKILL 设计，供未来问答助手**渐进式加载**：
   - 问答助手先扫所有 md 的 description 判断相关性
   - 命中才读正文（省 token，大库可跑）
3. description 要有**关键词提取**，密集信息便于检索预筛

---

## 三、description 字段设计（参考 SKILL）

### 格式
frontmatter 新增 `description` 字段，与现有 `summary` 并存：

```yaml
---
title: React 19 新特性完全指南
summary: React 19 新特性介绍与使用指南        # 保留：给人看的一句话摘要
description: "主题：React 19 并发渲染与新 API。关键词：并发渲染、Actions、useOptimistic、useFormStatus、Suspense、RSC、流式渲染。适用：查询 React 19 新特性、前端状态管理、服务端组件时参考。"
tags: [React, 前端开发]
---
```

### summary vs description 职责
| 字段 | 用途 | 特点 |
|---|---|---|
| summary | 给人看的内容摘要 | 精炼一句话，描述讲了什么 |
| description | 给问答助手检索路由 | 主题+关键词+适用场景，信息密集，约50-100字 |

### 问答助手工作流（后续实现，本期铺路）
```
用户提问
  ↓
[阶段1] 收集所有 md 的 description（轻量，不读正文）
  ↓ 模型判断哪些相关
[阶段2] 只读相关条目的正文 → 组织答案
```

---

## 四、后端实现

### 4.1 修复视频提取器（`extractor.js`）
`extractContent` 视频分支：正文 = 简介 + 字幕（拼接，有内容才拼）
```js
// 视频类：简介 + 字幕 都纳入正文
const parts = [];
if (video.description) parts.push(video.description);
if (video.subtitleText) parts.push(video.subtitleText);
return { ..., contentText: parts.join('\n\n'), ... };
```

### 4.2 AI 生成 description（`classifier-ai.js`）
- prompt 增加要求：生成 description 字段（主题 + 3-6个关键词 + 适用场景）
- `parseAIResponse` 读取 description
- `classifyByAI` 返回多带 description

prompt 关键句：
```
"description":"主题+3-6个关键概念+适用查询场景，给知识库问答助手做检索预筛用，约50-100字"
```

### 4.3 数据库迁移（`db/index.js`）
knowledge_entries 加 2 列：
- `description TEXT` - AI 生成的检索描述
- `md_path TEXT` - 记录生成的 .md 文件路径（用于覆盖更新，避免重复文件）

迁移函数 `migrateSchema()` 已有，加这两列。另外**回填 md_path**：扫描 `raw/articles/*.md`，读 frontmatter 的 id，回填对应条目的 md_path（让历史 md 也有映射，重新提取能覆盖不残留）。

### 4.4 renderEntryMd 加 description（`fs-wiki.js`）
frontmatter 输出 description（有才写）。

### 4.5 generateEntryMd 覆盖逻辑（`fs-wiki.js`）
```
有 md_path 且文件存在 -> 覆盖该文件内容（不改文件名）
无 md_path -> 按标题生成新文件名，写入，回填 md_path
```
避免重新提取时生成重复 md。

### 4.6 重新提取服务（新建 `services/reextract.js`）
```js
// 单条重新提取：提取正文 + AI 生成 description/分类 + 更新数据库 + 覆盖 md
async function reextractEntry(id)

// 全部重新提取：串行跑所有条目（或仅正文为空的）
async function reextractAll({ onlyEmpty = false })
```
流程：
1. 读条目（url, source_platform）
2. `extractContent(url, platform)` 重新提取 -> content_text
3. `classifyByAI` 重跑 -> description + 分类 + 摘要 + 标签
4. 更新数据库（content_text, description, 分类, summary, tags, ai_source, ai_confidence）
5. 重新生成 md（覆盖）
6. updateIndex

### 4.7 API（`routes/knowledge.js` + `routes/wiki.js`）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/knowledge/entries/:id/reextract` | 单条重新提取 |
| POST | `/api/wiki/reextract-all` | 全部重新提取（可选 onlyEmpty=true 只补空正文） |

---

## 五、前端实现

### 5.1 详情页（`EntryDetail.jsx`）
- 显示 description（如有，在摘要下方，标注"检索描述（供问答助手）"）
- 加「🔄 重新提取」按钮：调单条 reextract，loading 状态，完成后刷新

### 5.2 知识库页（`WikiPage.jsx` 或 FileExplorer）
- 工具栏加「🔄 全部重新提取」按钮（带确认提示：会调 AI，较慢）

### 5.3 api/index.js
- `knowledgeApi.reextract(id)`
- `wikiApi.reextractAll({ onlyEmpty })`

---

## 六、实施顺序

1. 修复视频提取器（extractor.js contentText = 简介+字幕）—— **立即修复提取 bug**
2. AI 生成 description（classifier-ai.js prompt + parse）
3. 数据库迁移（description + md_path 列 + 回填 md_path）
4. renderEntryMd 加 description + generateEntryMd 覆盖逻辑
5. reextract 服务 + API
6. 前端按钮 + description 展示
7. 验证：重新提取 B站/小红书/微信 -> 正文+description 生成 -> md 更新

---

## 七、验证点

- B站重新提取 -> md 正文有简介（138字），不再"暂无正文内容"
- 小红书重新提取 -> md 正文有笔记正文（223字）
- 微信 id:11 重新提取 -> md 正文有 8000 字
- 每个 md 的 frontmatter 有 description 字段（含关键词）
- 重新提取不产生重复 md（md_path 覆盖）
- 全部重新提取（onlyEmpty）只处理正文空的

---

## 八、风险与边界

| 项 | 处理 |
|---|---|
| 重新提取调 AI 慢 | 串行 + 前端 loading，全部提取提示用户耗时 |
| description 质量依赖 AI | prompt 约束格式，可后续 lint |
| md_path 回填 | 迁移时扫描 raw/articles 匹配 id |
| 手动改的 md 被覆盖 | 重新提取会覆盖（用户已改的内容丢失）—— 提示确认；或 onlyEmpty 只补空的不覆盖有内容的 |
| 抖音无 cookie | description 可能也拿不到，降级同 B站 |
| 问答助手 | 本期只铺路（生成 description），助手后续做 |
