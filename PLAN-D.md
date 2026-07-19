# PLAN-D：知识库 Markdown 文件系统

> 把采集入库的内容生成真实 .md 文件，做成可增删改查的文件系统（借鉴 kb-wiki 结构）
> SQLite 保留作采集索引层，markdown 文件作为可编辑知识产出层，外部 AI/Obsidian 可直接访问磁盘

---

## 一、目标与架构

### 用户决策（已确认）
1. **存储**：真实磁盘文件，`server/data/kb-wiki/` 下
2. **数据库**：SQLite 保留作采集索引层（AI 分类/去重/统计/检索），采集成功后额外生成 .md
3. **视频**：元数据 + 摘要 + 字幕（字幕作正文附录）

### 双层职责
```
采集流程：链接 -> 提取 -> AI 分类 -> 入库(SQLite) -> 生成 .md(raw/articles/)
                                                      ↓
                                       前端文件浏览器：浏览/编辑/新建/删除 .md
                                                      ↓
                                       外部 AI/Obsidian 直接读磁盘
```
- 数据库：采集来源 + 分类 + 检索（结构化，不变）
- 文件：可编辑知识页（用户可改，改了不回写数据库）

---

## 二、文件系统结构

### `server/data/kb-wiki/`
```
kb-wiki/
├── AGENTS.md        ← 给 AI 读的 Schema 层（目录说明+frontmatter 规范+维护指南）
├── index.md         ← 内容导航目录（按分类，自动生成）
├── log.md           ← 操作时间线（只追加）
├── raw/             ← 原始资料（采集产出 + 手动笔记，可编辑）
│   ├── articles/    ← 采集内容（微信图文/B站视频/抖音/小红书 都进这里）
│   ├── notes/       ← 用户手动创建的笔记
│   ├── papers/      ← 预留（空目录）
│   ├── books/       ← 预留
│   └── clippings/   ← 预留
├── wiki/            ← LLM 维护层（本期预留空目录，AI 后续填充）
│   ├── entities/
│   ├── concepts/
│   ├── topics/
│   ├── comparisons/
│   └── overviews/
└── templates/       ← 页面模板
    └── article.md
```

### Markdown 文件格式（frontmatter + 正文）
```markdown
---
id: 12
title: React 19 新特性完全指南
source: wechat
author: 前端技术精选
url: https://mp.weixin.qq.com/s/xxx
category: 科学技术/计算机与编程/前端开发
tags: [React, 前端开发, 新特性]
summary: React 19 新特性介绍与使用指南
collected_at: 2026-07-15T15:30:00Z
ai_source: full_content
ai_confidence: high
---

# React 19 新特性完全指南

（图文正文 / 视频字幕全文）
```

### 文件命名
- 标题清理（去 `/ \ : * ? " < > |`），保留中文
- 标题为空用 `untitled`
- 文件已存在则加短 hash 后缀：`React 19新特性完全指南-a3f2.md`

---

## 三、后端实现

### 3.1 新建 `services/fs-wiki.js`（核心文件系统服务）

```js
const KB_ROOT = path.join(__dirname, '..', '..', 'data', 'kb-wiki');

// 启动时确保目录结构 + AGENTS.md/index.md/templates 存在
initWiki()

// 从数据库条目生成 .md 到 raw/articles/
generateEntryMd(entry) -> { path, created }

// 文件操作（带路径安全校验，防 ../ 穿越）
listTree()              -> 递归目录树 [{name, path, type, children}]
readFile(relPath)       -> { content, path }
writeFile(relPath, content)  -> 改/新建
createFile(relPath, content)
deleteFile(relPath)
moveFile(oldRel, newRel)     // 可选，先不做

// 索引与日志
updateIndex()           -> 重新生成 index.md（按分类列出所有 raw/articles/*.md）
appendLog(action, relPath)   -> 追加 log.md 一行

// 路径安全：resolve 后检查 startsWith(KB_ROOT)，否则抛错
assertSafePath(relPath)
```

### 3.2 新建 `routes/wiki.js`（文件 API）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/wiki/tree` | 目录树（raw/ + wiki/ 递归） |
| GET | `/api/wiki/file?path=` | 读单个 .md 内容 |
| PUT | `/api/wiki/file?path=` | 写/改 .md（body: {content}） |
| POST | `/api/wiki/file` | 新建 .md（body: {path, content}） |
| DELETE | `/api/wiki/file?path=` | 删除 .md |
| POST | `/api/wiki/regenerate` | 从数据库重新生成所有 .md（补历史数据） |

### 3.3 采集流程集成（`routes/collect.js`）

改造 `batchUpsert` 返回 `insertedItems`（带 id + content_text），导入成功后对每条调用 `generateEntryMd`：

```js
const result = batchUpsert(allItems);
// 新增：为新增的有效条目生成 .md
for (const item of result.insertedItems.filter(i => i.is_valid === 1)) {
  await generateEntryMd(item);
}
await updateIndex();
appendLog('import', `${count} files`);
```

过滤的条目（is_valid=0）不生成 .md。

### 3.4 启动初始化（`index.js`）

`startServer` 里 `initDb()` 后加 `initWiki()`，创建目录骨架 + AGENTS.md + index.md + templates/article.md（不存在才写）。

### 3.5 AGENTS.md 内容（给后续 AI 读）

写明：目录结构、frontmatter schema、raw vs wiki 层职责、命名规范、维护指南（ingest/query/update 的约定）。这是用户后续接 AI 代理的入口文件。

---

## 四、前端实现

### 4.1 删除分类浏览
- `Sidebar.jsx`：移除 CategoryTree 和 onCategorySelect
- `App.jsx`：移除 categoryFilter state 和 handleCategorySelect
- `CategoryTree.jsx`：删除
- `KnowledgePage.jsx`：改为文件浏览器（或新建 WikiPage 替代）

### 4.2 新建文件浏览器（`components/Wiki/`）
- `FileExplorer.jsx`：左栏文件树（可折叠 raw/ wiki/，递归）+ 右栏编辑器
- `FileTree.jsx`：递归目录树组件（文件夹可展开，文件可点击）
- `MarkdownEditor.jsx`：编辑/预览切换
  - 编辑模式：textarea
  - 预览模式：react-markdown 渲染（支持 GFM 表格等）
  - 顶部：文件名 + 保存/删除按钮
- `FileToolbar.jsx`：新建文件按钮（选目录 + 文件名）

### 4.3 新建知识库页（`pages/WikiPage.jsx`）
替代 KnowledgePage，承载 FileExplorer。

### 4.4 导航调整（`Sidebar.jsx`）
```
导航：
- 📁 知识库      -> WikiPage（文件浏览器）
- 📥 采集导入    -> ImportPage
- 🗑️ 已过滤      -> FilteredPage（保留列表，已过滤条目不生成 .md）
- ⚙️ 规则管理    -> RulesPage
```
移除「分类浏览」整块。

### 4.5 新依赖
- `react-markdown` + `remark-gfm`（markdown 渲染，安全不直接 innerHTML）

### 4.6 API 封装（`api/index.js`）
新增 `wikiApi`：`getTree / getFile / saveFile / createFile / deleteFile / regenerate`

---

## 五、保留与删除清单

| 处理 | 文件 |
|---|---|
| **新建** | `server/src/services/fs-wiki.js`、`server/src/routes/wiki.js` |
| **新建** | `client/src/components/Wiki/{FileExplorer,FileTree,MarkdownEditor,FileToolbar}.jsx` |
| **新建** | `client/src/pages/WikiPage.jsx` |
| **新建** | `server/data/kb-wiki/` 整个目录骨架 |
| **改造** | `collect.js`（生成 .md）、`index.js`（initWiki）、`batchUpsert`（返回 insertedItems） |
| **改造** | `Sidebar.jsx`、`App.jsx`（删分类浏览）、`api/index.js`（加 wikiApi） |
| **删除** | `CategoryTree.jsx`、`KnowledgePage.jsx`（被 WikiPage 替代） |
| **保留** | `EntryList.jsx`（已过滤页用）、`FilteredPage.jsx`、`RulesPage.jsx`、`ImportPanel.jsx` |

---

## 六、实施顺序

1. **后端文件系统服务**：`fs-wiki.js`（路径安全 + 目录初始化 + generateEntryMd + 文件 CRUD + updateIndex + appendLog）
2. **wiki API 路由**：`routes/wiki.js` + 挂载到 `index.js`
3. **启动初始化**：`initWiki()` 生成 AGENTS.md/index.md/templates/目录骨架
4. **采集集成**：`batchUpsert` 返回 insertedItems，`collect.js` 生成 .md
5. **前端依赖**：装 react-markdown + remark-gfm
6. **前端文件浏览器**：FileExplorer/FileTree/MarkdownEditor + WikiPage
7. **删分类浏览 + 导航调整**
8. **验证**

---

## 七、验证点

- 后端启动 -> `kb-wiki/` 目录骨架 + AGENTS.md 生成
- 采集微信图文 -> 数据库有条目 + `raw/articles/xxx.md` 生成（含 frontmatter + 正文）
- 采集 B站视频 -> `raw/articles/xxx.md`（含字幕附录）
- 前端文件树能看到 .md，点击编辑保存 -> 磁盘文件更新
- 新建/删除文件 -> 磁盘 + index.md 同步
- `/api/wiki/regenerate` -> 历史条目补生成 .md
- 路径穿越攻击（`../../etc/passwd`）被拒绝
- 外部用编辑器/资源管理器能直接打开 `server/data/kb-wiki/` 看到 .md

---

## 八、风险与边界

| 项 | 处理 |
|---|---|
| 路径穿越 | resolve 后 startsWith(KB_ROOT)，否则拒绝 |
| 文件名冲突 | 标题 + 短 hash 后缀 |
| 中文文件名 | 文件系统支持，Windows/macOS 均可 |
| markdown XSS | react-markdown 不直接 innerHTML，安全 |
| 编辑不回写数据库 | 设计如此，数据库只管采集来源 |
| wiki/ 层空 | 本期预留，AI 蒸馏是用户后续接 AI 的事 |
| 已过滤条目 | 不生成 .md，留在数据库 + 已过滤页 |
