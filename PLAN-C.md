# PLAN-C：采集分治与知识库增强

> 基于 HANDOVER.md 现状，解决「微信/抖音采集失败」+「知识库结构化不足」两个问题
> 知识库方向参考掘金 obsidian-wiki 文章理念，在现有 React+SQLite Web 系统内增强

---

## 一、问题诊断

### 1.1 采集失败的根因

`server/src/routes/collect.js` 的 `processItem` 对**所有平台**硬编码走 `extractVideo`（yt-dlp）：

| 平台 | 内容类型 | 现状 | 问题 |
|---|---|---|---|
| B站 | 视频 | yt-dlp 提取标题+字幕 | ✅ 正常 |
| 小红书 | 视频/图文 | yt-dlp 提取 | ✅ 正常 |
| 抖音 | 视频 | yt-dlp Douyin extractor | ⚠️ 短链未解析、字幕常缺失 |
| 微信公众号 | **图文** | yt-dlp（只懂视频） | ❌ 提不到正文，只剩标题，AI 信息不足 |

核心问题：**没有按内容类型分流提取器**。图文内容必须走 HTTP 抓取，不能走 yt-dlp。

### 1.2 知识库的不足（对照 obsidian-wiki 理念）

| obsidian-wiki 理念 | 当前 Knowledge Vault | 差距 |
|---|---|---|
| 完整正文蒸馏成知识页 | 只存 50 字 AI 摘要 | 原文丢失，无法回溯 |
| delta 增量跟踪 | 仅 URL 去重 | 同内容不同 URL 重复入库 |
| 来源标签可追溯 | 无 | 不知 AI 结论基于完整正文还是仅标题 |
| 交叉链接（wikilinks） | 无 | 知识孤立，无关联 |
| 分层检索 | LIKE 全表扫 | 数据量大后慢 |
| 知识图谱 | 无 | 无法可视化知识结构 |

---

## 二、阶段一：采集分治（优先，解决报错）

### 2.1 新建 `server/src/services/url-utils.js`（抖音短链/口令解析）

```js
// 从抖音分享口令文本提取 URL
// 输入："7.99 复制打开抖音，看看【小天的内容】 https://v.douyin.com/iABC123/ 点赞"
// 输出："https://v.douyin.com/iABC123/"
extractUrlFromText(text)

// 短链重定向解析（HEAD 请求跟随 Location）
// v.douyin.com/iABC123 -> www.douyin.com/video/721...
resolveShortUrl(url)

// 综合：口令文本 -> 真实 URL
normalizeShareUrl(text)
```

- 用 Node 内置 `http`/`https`，避免加依赖
- 超时 8 秒，失败返回原 URL（不阻断流程）

### 2.2 新建 `server/src/services/extractor-article.js`（微信图文抓取）

```js
extractArticle(url)
// 返回 { title, author, description, contentText, thumbnail }
```

- `fetch`（Node 18+ 内置）抓 `mp.weixin.qq.com/s/xxx` HTML
- 带浏览器 UA 头，超时 30 秒
- 正则/简易解析提取：
  - 标题：`<h1 id="activity-name">` 或 `<meta property="og:title">`
  - 公众号名：`<a id="js_name">`
  - 正文：`<div id="js_content">` 去 HTML 标签纯文本
  - 摘要：`<meta name="description">`
- 正文截断 8000 字喂 AI
- **不引入 cheerio**，用正则 + 简易标签剥离（公众号 HTML 结构稳定，避免加依赖）

### 2.3 改造 `server/src/services/extractor.js`（分发器）

新增分发函数，保留 `extractVideo` 兼容：

```js
// 按平台内容类型分发
const VIDEO_PLATFORMS = ['bilibili', 'douyin', 'xiaohongshu'];
const ARTICLE_PLATFORMS = ['wechat'];

function extractContent(url, platform) {
  if (ARTICLE_PLATFORMS.includes(platform)) return extractArticle(url);
  return extractVideo(url);  // 视频型
}
module.exports = { extractVideo, extractArticle, extractContent };
```

### 2.4 改造 `server/src/routes/collect.js` 的 `processItem`

```js
async function processItem(item) {
  // 1. 短链/口令解析（抖音等）
  if (item.url) {
    item.url = await normalizeShareUrl(item.url);  // 新增
  }

  // 2. 按平台类型提取
  let extracted = { ... };
  if (item.url) {
    extracted = await extractContent(item.url, item.source_platform);  // 改：按平台分发
  }

  // 3. 统一为 contentText（视频用字幕，图文用正文）
  const enriched = {
    ...item,
    title: item.title || extracted.title || '',
    source_author: item.source_author || extracted.author || '',
    summary: item.summary || extracted.description || '',
    contentText: extracted.subtitleText || extracted.contentText || '',  // 新：统一字段
  };

  // 4. 过滤 + AI 分类（传 contentText）
  // ...
  const aiResult = await classifyByAI({
    title, author, description,
    contentText: enriched.contentText,  // 改：统一字段名
  });
}
```

### 2.5 改造 `server/src/services/classifier-ai.js`（字段泛化）

- `subtitleText` → `contentText`（兼容旧名）
- systemPrompt：`字幕内容` → `正文/字幕内容`
- 新增（阶段二用到）：返回 `ai_source`、`ai_confidence`

### 2.6 改造前端（`ImportPanel.jsx` / `PlatformSelector.jsx`）

- 导入提示文案区分图文/视频平台
- 微信公众号 placeholder 改为文章链接示例
- 抖音支持粘贴口令文本（前端按行，每行一个口令/链接）

### 2.7 抖音 cookie 支持（可选，`.env`）

- 新增 `DOUYIN_COOKIE_FILE` 环境变量
- yt-dlp 带抖音 cookie（部分视频需登录）
- 与 B站 cookie 同机制

---

## 三、阶段二：知识库增强（借鉴 obsidian-wiki）

### 3.1 数据库 schema 扩展（`db/index.js` initTables）

`knowledge_entries` 表新增列（用 `ALTER TABLE ADD COLUMN`，检测列是否存在）：

| 列 | 类型 | 用途 | 对应 obsidian-wiki 理念 |
|---|---|---|---|
| `content_text` | TEXT | 完整正文/字幕原文 | 知识页正文 |
| `content_hash` | TEXT | 正文指纹（前 2000 字 MD5） | delta 去重 |
| `ai_source` | TEXT | `full_content`/`title_only`/`keyword_fallback` | 来源可追溯 |
| `ai_confidence` | TEXT | `high`/`medium`/`low` | 置信度 |
| `related_ids` | TEXT | 相关条目 ID JSON 数组 | 交叉链接 |

### 3.2 服务层改造（`knowledge.js`）

- `batchUpsert`：新增 `content_hash` 去重（URL 不同但内容相同 → 跳过或标记）
- 新增 `getRelated(id)`：基于 `category_l1/l2` + 共同标签计算相关条目
- `getEntries` 搜索分层：默认查标题/摘要/标签（快），`?searchFull=1` 查正文（全）

### 3.3 新建 `server/src/services/linker.js`（交叉链接）

```js
findRelated(entryId, limit = 5)
// 基于 category_l1/l2 命中 + 共同 tags 数量排序
// 返回相关条目 ID 列表
```

- 导入后自动调用，回填 `related_ids`

### 3.4 AI 分类器增强（`classifier-ai.js`）

- prompt 让 AI 自评：判断基于多少内容（`full`/`partial`/`title_only`）+ 置信度
- 返回 `ai_source` / `ai_confidence`
- frontmatter 式可追溯（obsidian-wiki 的 extracted/inferred 思路简化版）

### 3.5 前端增强

- `EntryDetail.jsx`：展示完整正文（可折叠）、来源标签徽章（`full_content` 绿/`title_only` 黄）、相关收藏列表（点击跳转）
- 新增知识图谱视图：按分类聚合的节点图（先做分类统计柱状/树状图，力导向图作为后续）
- `FilteredPage.jsx`：已过滤内容也展示 filter_reason 来源

---

## 四、实施顺序与验证

### 第一批（采集分治，本轮重点）
1. `url-utils.js`（抖音短链/口令）
2. `extractor-article.js`（微信图文）
3. `extractor.js` 分发
4. `collect.js` processItem 改造
5. `classifier-ai.js` 字段泛化
6. 前端文案适配

**验证**：
- 导入真实微信公众号文章 → AI 拿到正文 → 分类正确
- 粘贴抖音口令文本 → 解析为 URL → yt-dlp 提取 → 分类
- B站/小红书回归不破坏

### 第二批（知识库增强，分步）
7. schema 扩展（ALTER TABLE）
8. `knowledge.js` 去重 + 关联 + 分层检索
9. `linker.js` 交叉链接
10. `classifier-ai.js` 来源标签
11. 前端展示增强

**验证**：
- 导入同内容不同 URL → 去重
- 详情页看到正文 + 来源标签 + 相关收藏
- 搜索正文能命中

---

## 五、风险与规避

| 风险 | 规避 |
|---|---|
| 公众号反爬（需 UA/Referer） | 带浏览器 UA，失败降级用标题 |
| 抖音短链重定向失败 | 超时 8 秒，失败用原 URL 不阻断 |
| sql.js 不支持 ALTER ADD COLUMN | SQLite 标准支持，检测列存在再 ADD |
| cheerio 加重依赖 | 不引入，用正则解析公众号稳定结构 |
| 正文过长撑爆 AI 上下文 | 截断 8000 字，与现有字幕 6000 字一致 |
| 前端图文/视频混用 | 按 platform 字段在 UI 区分提示 |

---

## 六、不做的（明确边界）

- 不接入真实 Obsidian（用户已选 Web 内增强）
- 不上 FTS5（sql.js WASM 不一定编译，先用 LIKE + content_text 字段）
- 不做力导向图谱（先做分类聚合统计，图谱后续）
- 不抓取需要登录的平台私有内容（合规，沿用 HANDOVER 原则）
