/**
 * 知识库 Markdown 文件系统服务
 *
 * 在 server/data/kb-wiki/ 下维护真实 .md 文件，结构借鉴 obsidian-wiki：
 *   raw/articles/  采集内容（图文正文 / 视频字幕）
 *   raw/notes/     用户手动笔记
 *   wiki/          LLM 维护层（预留，AI 后续填充）
 *   AGENTS.md      给 AI 读的 Schema 层
 *   index.md       内容导航（按分类，自动生成）
 *   log.md         操作时间线（只追加）
 *
 * 所有文件操作都经 assertSafePath 校验，防止 ../ 路径穿越。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KB_ROOT = path.join(__dirname, '..', '..', 'data', 'kb-wiki');

// 目录骨架（启动时确保存在）
const DIR_STRUCTURE = [
  'raw/articles',
  'raw/notes',
  'raw/papers',
  'raw/books',
  'raw/clippings',
  'wiki/entities',
  'wiki/concepts',
  'wiki/topics',
  'wiki/comparisons',
  'wiki/overviews',
  'templates',
];

// 文件名非法字符（Windows + 通用）
const ILLEGAL_FILENAME_CHARS = /[\/\\:*?"<>|]/g;

// ============ 路径安全 ============

/**
 * 把相对路径解析为绝对路径，并校验仍在 KB_ROOT 内（防穿越）
 * @param {string} relPath 用户传入的相对路径（如 raw/articles/x.md）
 * @returns {string} 安全的绝对路径
 */
function assertSafePath(relPath) {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('路径不能为空');
  }
  // 规范化：去掉开头的 / 和 ./，禁止绝对路径
  let cleaned = relPath.replace(/^\.?\//, '');
  if (path.isAbsolute(cleaned)) {
    throw new Error('不允许绝对路径');
  }
  const abs = path.resolve(KB_ROOT, cleaned);
  const root = path.resolve(KB_ROOT);
  // 必须在 KB_ROOT 内（用 path.relative 检测 .. 逃逸）
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界，拒绝访问: ${relPath}`);
  }
  return abs;
}

// ============ 目录初始化 ============

/**
 * 启动时确保 kb-wiki 目录结构 + 基础文件存在
 * 已存在则跳过，可重复执行
 */
function initWiki() {
  if (!fs.existsSync(KB_ROOT)) {
    fs.mkdirSync(KB_ROOT, { recursive: true });
  }
  for (const dir of DIR_STRUCTURE) {
    const full = path.join(KB_ROOT, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }
  // 基础文件（不存在才写，避免覆盖用户改动）
  ensureFile('AGENTS.md', AGENTS_MD_CONTENT);
  ensureFile('index.md', INDEX_INIT_CONTENT);
  ensureFile('log.md', LOG_INIT_CONTENT);
  ensureFile('templates/article.md', TEMPLATE_ARTICLE_CONTENT);
}

function ensureFile(relPath, defaultContent) {
  const abs = path.join(KB_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, defaultContent, 'utf-8');
  }
}

// ============ 生成条目 Markdown ============

/**
 * 从数据库条目生成 .md 文件到 raw/articles/
 * - 有 md_path 且文件存在 -> 覆盖该文件（重新提取不产生重复）
 * - 无 md_path -> 按标题生成文件名，同名则加 hash 后缀
 * @param {object} entry - 含 id/title/source_platform/.../content_text/description/md_path
 * @returns {{path: string, created: boolean, overwritten: boolean}}
 */
function generateEntryMd(entry) {
  const title = entry.title || 'untitled';
  const content = renderEntryMd(entry);

  // 1. 已有 md_path 且文件存在 -> 覆盖（重新提取场景）
  if (entry.md_path) {
    const existingAbs = assertSafePath(entry.md_path);
    if (fs.existsSync(existingAbs)) {
      fs.writeFileSync(existingAbs, content, 'utf-8');
      return { path: entry.md_path, created: false, overwritten: true };
    }
  }

  // 2. 新生成：按标题命名，同名加 hash 后缀
  const filename = makeFilename(title);
  let relPath = `raw/articles/${filename}`;
  let abs = assertSafePath(relPath);
  if (fs.existsSync(abs)) {
    const hash = shortHash(String(entry.id || '') + (entry.url || '') + title);
    const hashedName = `${stripExt(filename)}-${hash}.md`;
    relPath = `raw/articles/${hashedName}`;
    abs = assertSafePath(relPath);
  }

  fs.writeFileSync(abs, content, 'utf-8');
  return { path: relPath, created: true, overwritten: false };
}

/**
 * 渲染条目为 markdown 字符串（frontmatter + 正文）
 */
function renderEntryMd(entry) {
  const category = [entry.category_l1, entry.category_l2, entry.category_l3]
    .filter(Boolean)
    .join('/');
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const fm = [
    '---',
    entry.id ? `id: ${entry.id}` : null,
    `title: ${yamlEscape(entry.title || '')}`,
    `source: ${entry.source_platform || ''}`,
    `author: ${yamlEscape(entry.source_author || '')}`,
    `url: ${entry.url || ''}`,
    category ? `category: ${yamlEscape(category)}` : null,
    tags.length ? `tags: [${tags.map((t) => yamlEscape(String(t))).join(', ')}]` : null,
    entry.summary ? `summary: ${yamlEscape(entry.summary)}` : null,
    entry.description ? `description: ${yamlEscape(entry.description)}` : null,
    entry.collected_at ? `collected_at: ${entry.collected_at}` : null,
    entry.ai_source ? `ai_source: ${entry.ai_source}` : null,
    entry.ai_confidence ? `ai_confidence: ${entry.ai_confidence}` : null,
    '---',
    '',
  ].filter((l) => l !== null).join('\n');

  const bodyTitle = `# ${entry.title || '(无标题)'}`;
  const content = entry.content_text || entry.contentText || '';
  const body = content ? `\n${content}` : '\n（暂无正文内容）';

  return `${fm}\n${bodyTitle}\n${body}\n`;
}

// ============ 文件 CRUD ============

/**
 * 递归列出目录树
 * @returns {Array} [{name, path, type:'dir'|'file', children?}]
 */
function listTree() {
  return walkDir(KB_ROOT, '');
}

function walkDir(absBase, relBase) {
  const entries = fs.readdirSync(absBase, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    // 跳过隐藏文件
    if (e.name.startsWith('.')) continue;
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      result.push({
        name: e.name,
        path: rel,
        type: 'dir',
        children: walkDir(path.join(absBase, e.name), rel),
      });
    } else if (e.isFile() && e.name.endsWith('.md')) {
      result.push({ name: e.name, path: rel, type: 'file' });
    }
  }
  // 目录在前，文件在后；各自按名排序
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });
  return result;
}

function readFile(relPath) {
  const abs = assertSafePath(relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`文件不存在: ${relPath}`);
  }
  const content = fs.readFileSync(abs, 'utf-8');
  return { path: relPath, content };
}

function writeFile(relPath, content) {
  const abs = assertSafePath(relPath);
  if (!abs.endsWith('.md')) {
    throw new Error('只允许操作 .md 文件');
  }
  // 确保父目录存在
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const existed = fs.existsSync(abs);
  fs.writeFileSync(abs, content || '', 'utf-8');
  appendLog(existed ? 'edit' : 'create', relPath);
  updateIndex();
  return { path: relPath, saved: true };
}

function createFile(relPath, content) {
  const abs = assertSafePath(relPath);
  if (!abs.endsWith('.md')) {
    throw new Error('只允许创建 .md 文件');
  }
  if (fs.existsSync(abs)) {
    throw new Error(`文件已存在: ${relPath}`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content || '', 'utf-8');
  appendLog('create', relPath);
  updateIndex();
  return { path: relPath, created: true };
}

function deleteFile(relPath) {
  const abs = assertSafePath(relPath);
  // 禁止删除基础文件和根目录
  const protectedFiles = ['AGENTS.md', 'index.md', 'log.md', 'templates/article.md'];
  if (protectedFiles.includes(relPath.replace(/\\/g, '/'))) {
    throw new Error('受保护文件不可删除');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`文件不存在: ${relPath}`);
  }
  fs.unlinkSync(abs);
  appendLog('delete', relPath);
  updateIndex();
  return { path: relPath, deleted: true };
}

// ============ 索引与日志 ============

/**
 * 重新生成 index.md：按分类分组列出 raw/articles/ 下所有 .md
 * 解析每个文件的 frontmatter 取 title 和 category
 */
function updateIndex() {
  const articlesDir = path.join(KB_ROOT, 'raw', 'articles');
  if (!fs.existsSync(articlesDir)) return;

  const files = fs.readdirSync(articlesDir).filter((f) => f.endsWith('.md'));
  const grouped = {}; // category -> [{title, path}]

  for (const f of files) {
    const abs = path.join(articlesDir, f);
    const content = fs.readFileSync(abs, 'utf-8');
    const meta = parseFrontmatter(content);
    const cat = meta.category || '未分类';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      title: meta.title || stripExt(f),
      path: `raw/articles/${f}`,
    });
  }

  const lines = [
    '# 知识库导航',
    '',
    `> 自动生成，按分类列出 raw/articles/ 下的所有知识页。共 ${files.length} 篇。`,
    '',
  ];
  const cats = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'zh'));
  for (const cat of cats) {
    lines.push(`## ${cat}`);
    lines.push('');
    for (const item of grouped[cat]) {
      lines.push(`- [${item.title}](${item.path.replace(/ /g, '%20')})`);
    }
    lines.push('');
  }

  fs.writeFileSync(path.join(KB_ROOT, 'index.md'), lines.join('\n'), 'utf-8');
}

/**
 * 追加操作日志到 log.md（只追加）
 */
function appendLog(action, relPath) {
  const line = `- [${new Date().toISOString()}] ${action} ${relPath.replace(/\\/g, '/')}\n`;
  fs.appendFileSync(path.join(KB_ROOT, 'log.md'), line, 'utf-8');
}

/**
 * 从数据库重新生成所有有效条目的 .md（补历史数据）
 * @param {Array} entries - 数据库条目数组
 * @returns {{generated: number, skipped: number}}
 */
function regenerateAll(entries) {
  let generated = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.is_valid !== 1) {
      skipped++;
      continue;
    }
    try {
      generateEntryMd(entry);
      generated++;
    } catch (err) {
      console.error(`[wiki] 生成失败 ${entry.title}:`, err.message);
      skipped++;
    }
  }
  updateIndex();
  appendLog('regenerate', `${generated} files`);
  return { generated, skipped };
}

// ============ 工具函数 ============

function makeFilename(title) {
  let name = (title || 'untitled').replace(ILLEGAL_FILENAME_CHARS, '').trim();
  if (!name) name = 'untitled';
  // 限制长度
  if (name.length > 60) name = name.slice(0, 60);
  return `${name}.md`;
}

function stripExt(filename) {
  return filename.replace(/\.md$/i, '');
}

function shortHash(input) {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 6);
}

function yamlEscape(s) {
  // 含特殊字符的值加引号
  if (!s) return s;
  if (/[:\[\]{}&,*#?|<>%@`"'\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * 简易 YAML frontmatter 解析（只取 title / category）
 */
function parseFrontmatter(content) {
  const meta = {};
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return meta;
  const block = m[1];
  const titleMatch = block.match(/^title:\s*(.+)$/m);
  if (titleMatch) meta.title = unescapeYaml(titleMatch[1]);
  const catMatch = block.match(/^category:\s*(.+)$/m);
  if (catMatch) meta.category = unescapeYaml(catMatch[1]);
  return meta;
}

function unescapeYaml(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

/**
 * 完整 frontmatter 解析（解析所有顶层 key，支持数组/布尔/数字/标量）
 * 供 wiki 蒸馏页与问答助手复用。简易解析，不依赖 yaml 库。
 * @param {string} content
 * @returns {object} meta - 如 { type, title, description, source_ids:[3,7], related:[...], ai_generated:true }
 */
function parseFullFrontmatter(content) {
  const meta = {};
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return meta;
  const block = m[1];
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!km) continue;
    const key = km[1];
    let val = km[2].trim();
    if (val === '') {
      meta[key] = '';
      continue;
    }
    if (val.startsWith('[')) {
      // 数组：优先 JSON.parse，失败则逗号分隔兜底
      try {
        meta[key] = JSON.parse(val);
      } catch {
        const inner = val.replace(/^\[|\]$/g, '');
        meta[key] = inner
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
    } else if (val === 'true') {
      meta[key] = true;
    } else if (val === 'false') {
      meta[key] = false;
    } else if (/^-?\d+$/.test(val)) {
      meta[key] = Number(val);
    } else {
      meta[key] = unescapeYaml(val);
    }
  }
  return meta;
}

// ============ 静态文件内容 ============

const AGENTS_MD_CONTENT = `# AGENTS.md — 知识库 Schema 层

> 本文件供 AI 代理（Claude Code / Cursor / Codex 等）读取，理解如何维护此知识库。

## 目录结构

\`\`\`
kb-wiki/
├── AGENTS.md        ← 本文件（Schema 层，给 AI 读）
├── index.md         ← 内容导航（按分类，自动生成，勿手改）
├── log.md           ← 操作时间线（只追加）
├── raw/             ← 原始资料（采集产出 + 手动笔记，可编辑）
│   ├── articles/    ← 采集内容（图文正文 / 视频字幕）
│   ├── notes/       ← 手动笔记
│   ├── papers/      ← 论文（预留）
│   ├── books/       ← 书籍笔记（预留）
│   └── clippings/   ← 网页抓取（预留）
├── wiki/            ← LLM 维护层（蒸馏后的知识页）
│   ├── entities/    ← 人物、工具、项目、组织
│   ├── concepts/    ← 技术概念、术语
│   ├── topics/      ← 主题综合页
│   ├── comparisons/ ← 对比分析
│   └── overviews/   ← 高层概览
└── templates/       ← 页面模板
\`\`\`

## 两层职责

- **raw/**：原始资料层。采集系统自动写入（\`raw/articles/\`），用户也可手动建笔记（\`raw/notes/\`）。此层是"事实来源"，可编辑但不删除原始采集记录。
- **wiki/**：LLM 维护层。AI 从 raw/ 蒸馏出概念、实体、主题页，建立交叉链接。此层是"加工产物"。

## Frontmatter Schema

### raw/ 原始资料页（采集 / 笔记）

\`\`\`yaml
---
id: 12                       # 数据库条目 ID（采集来源关联，可选）
title: 页面标题
source: wechat               # 采集平台（bilibili/douyin/xiaohongshu/wechat），手动笔记留空
author: 原作者
url: 原始链接
category: 科学技术/计算机与编程/前端开发   # 三级分类，斜杠分隔
tags: [React, 前端开发]       # 标签
summary: 50 字摘要
collected_at: 2026-07-15T15:30:00Z
ai_source: full_content       # AI 分类依据：full_content/partial_content/title_only/keyword_fallback
ai_confidence: high          # 置信度：high/medium/low
---
\`\`\`

### wiki/ 蒸馏知识页（AI 生成，问答助手检索此层）

\`\`\`yaml
---
type: concept                 # concept/entity/topic/comparison/overview
title: LangChain
description: "主题+3-6关键词+适用查询场景，供问答助手预筛检索"   # 渐进式检索字段
source_ids: [3, 7]            # 关联的 raw 条目 id
related: ["LangGraph", "RAG"]  # 交叉链接（wiki 页标题）
ai_generated: true            # 蒸馏产物标记（重蒸馏只删这种）
distilled_at: 2026-07-16T12:00:00Z
---
\`\`\`

问答助手两阶段检索：① 扫 wiki 页 description 预筛 -> ② 读正文流式答题 + [1][2] 引用。检索 wiki 蒸馏层，不是 raw 原文。

## 命名规范

- 文件名：标题清理后（去特殊字符），保留中文，\`.md\` 后缀
- 冲突加 6 位 hash：\`React 19新特性-a3f2b1.md\`
- 路径全部相对 kb-wiki/ 根

## AI 维护指南

- **ingest**：新资料进 \`raw/articles/\`，自动带 frontmatter
- **distill**：从多个 raw 页提炼共性 -> 写入 \`wiki/concepts/\` 或 \`wiki/topics/\`，用 \`[[wikilink]]\` 交叉引用
- **update**：改 raw 页正文不改 frontmatter 的采集字段（source/url 等）
- **query**：先扫 index.md / frontmatter 定位，再读全文
- **lint**：检查断链、孤立页、过期内容

## 约定

- 手动笔记放 \`raw/notes/\`，frontmatter 至少有 title
- 受保护文件：\`AGENTS.md\` \`index.md\` \`log.md\` \`templates/\`，不可删
- 编辑文件后 \`index.md\` 自动重生成
`;

const INDEX_INIT_CONTENT = `# 知识库导航

> 自动生成，按分类列出 raw/articles/ 下的所有知识页。暂无内容，采集导入后自动填充。
`;

const LOG_INIT_CONTENT = `# 操作日志

> 只追加，记录知识库文件操作时间线。

`;

const TEMPLATE_ARTICLE_CONTENT = `---
title:
source:
author:
url:
category:
tags: []
summary:
---

# 标题

正文内容...
`;

module.exports = {
  KB_ROOT,
  initWiki,
  generateEntryMd,
  renderEntryMd,
  listTree,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  updateIndex,
  appendLog,
  regenerateAll,
  assertSafePath,
  makeFilename,
  yamlEscape,
  parseFullFrontmatter,
};
