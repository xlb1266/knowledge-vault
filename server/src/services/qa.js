/**
 * 问答助手（检索 wiki 蒸馏层，而非 raw 原文）
 *
 * 两阶段渐进式检索（省 token）：
 *   1. 预筛：扫所有 wiki 页的 description（轻量），AI 选出与问题相关的页标题（≤5）
 *   2. 答题：只读相关 wiki 页正文（蒸馏知识 + [[交叉链接]]），AI 流式组织答案，标注 [1][2] 引用
 *
 * 关键：检索对象是 wiki/ 蒸馏层（已加工、互相关联），不是 raw/articles 原文。
 * wiki 层为空时引导用户先蒸馏。
 */

const fs = require('fs');
const path = require('path');
const { getClient, isAIAvailable, MODEL } = require('./ai-client');
const { KB_ROOT, parseFullFrontmatter } = require('./fs-wiki');

const WIKI_TYPES = ['entities', 'concepts', 'topics', 'comparisons', 'overviews'];
const MAX_PAGES = 5; // 答题最多引用的 wiki 页
const MAX_PAGE_CHARS = 3000; // 单页正文截断
const HISTORY_TURNS = 4; // 保留最近几轮（=2×该数的 message）

/**
 * 流式问答
 * @param {string} question
 * @param {Array<{role, content}>} history
 * @param {function} onEvent - (type, payload) 事件回调
 */
async function answerQuestionStream(question, history, onEvent) {
  if (!isAIAvailable()) {
    onEvent('error', { message: 'AI 未配置（缺 SILICONFLOW_API_KEY 或为占位符），无法问答' });
    return;
  }

  // 0. 扫描 wiki 蒸馏层
  const pages = scanWikiPages();
  if (!pages.length) {
    onEvent('error', {
      message: '知识库 wiki 层为空，请先到「📁 知识库」点 🧪 蒸馏，把 raw 原文提炼成 wiki 知识页后再问答。',
    });
    return;
  }

  // 1. 预筛
  onEvent('status', { message: '正在检索知识库...' });
  let relevantTitles = await selectRelevant(question, pages);
  // 兜底：预筛失败/为空 -> 库小时取全部
  if (!relevantTitles.length) {
    relevantTitles = pages.slice(0, MAX_PAGES).map((p) => p.title);
  }

  // 预筛返回的标题可能不精确匹配页面标题（如 AI 返回"LangChain框架应用"但页面标题是"LangChain"），
  // 用 includes 做模糊匹配，命中即取
  const relevant = relevantTitles
    .map((t) => pages.find((p) => p.title === t || p.title.includes(t) || t.includes(p.title)))
    .filter(Boolean)
    .slice(0, MAX_PAGES);

  // 兜底：模糊匹配全部落空（预筛标题与实际页面标题差异大）时，取前 N 页，保证有素材可答
  if (!relevant.length) {
    relevant.push(...pages.slice(0, MAX_PAGES));
  }

  // 2. 发引用来源卡片（先于答题，前端可立即展示）
  onEvent('citations', {
    items: relevant.map((p, i) => ({
      index: i + 1,
      title: p.title,
      type: p.type,
      path: p.path,
      source_ids: p.source_ids || [],
    })),
  });

  // 3. 读相关 wiki 页正文（去掉 frontmatter）
  const refs = relevant.map((p, i) => ({
    index: i + 1,
    title: p.title,
    content: stripFrontmatter(p.raw).slice(0, MAX_PAGE_CHARS),
  }));

  // 4. 流式答题
  onEvent('status', { message: '正在组织答案...' });
  const openai = getClient();
  const stream = await openai.chat.completions.create({
    model: MODEL,
    stream: true,
    temperature: 0.4,
    max_tokens: 1500,
    enable_thinking: false,
    messages: buildAnswerMessages(question, history, refs),
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onEvent('delta', { text: delta });
  }
  onEvent('done', {});
}

/**
 * 阶段1：预筛相关 wiki 页（非流式 JSON）
 */
async function selectRelevant(question, pages) {
  const openai = getClient();
  const list = pages
    .map((p) => `[#${p.title}] ${p.description || '(无描述)'}`)
    .join('\n');

  const systemPrompt = `用户提出一个问题，下面是知识库 wiki 层所有页面的标题与检索描述。
返回与问题最相关的页面标题数组（最多 ${MAX_PAGES} 个，按相关性排序）。
只返回 JSON 字符串数组，如 ["LangChain","RAG应用"]。若无相关页面返回 []。

页面清单：
${list}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ],
    temperature: 0.2,
    max_tokens: 300,
    enable_thinking: false,
  });

  const text = completion.choices[0]?.message?.content || '';
  return parseStringArray(text);
}

/**
 * 组装答题消息（system + history + question）
 */
function buildAnswerMessages(question, history, refs) {
  const refText = refs
    .map((r) => `[${r.index}] ${r.title}\n${r.content}`)
    .join('\n\n---\n\n');

  const systemPrompt = `你是知识库问答助手。严格基于下方"参考资料"回答用户问题。

规则：
1. 只用参考资料中的信息，不得编造。
2. 资料不足以回答时，明确说明"现有知识库中暂无足够相关内容"。
3. 引用资料时用 [1][2] 标记，编号对应参考资料序号。
4. 答案用中文，结构清晰，可适当用 markdown。

参考资料（wiki 蒸馏知识页）：
${refText}`;

  const messages = [{ role: 'system', content: systemPrompt }];
  // 历史对话（限最近几轮，控 token）
  const recent = Array.isArray(history) ? history.slice(-HISTORY_TURNS * 2) : [];
  for (const m of recent) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: question });
  return messages;
}

// ============ wiki 页扫描 ============

/**
 * 扫描 wiki/{五类}/ 下所有 .md，解析 frontmatter
 * @returns {Array<{title, description, type, source_ids, related, path, raw}>}
 */
function scanWikiPages() {
  const result = [];
  for (const type of WIKI_TYPES) {
    const dir = path.join(KB_ROOT, 'wiki', type);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const abs = path.join(dir, f);
      try {
        const raw = fs.readFileSync(abs, 'utf-8');
        const meta = parseFullFrontmatter(raw);
        if (!meta.title) continue;
        result.push({
          title: meta.title,
          description: meta.description || '',
          type,
          source_ids: Array.isArray(meta.source_ids) ? meta.source_ids : [],
          related: Array.isArray(meta.related) ? meta.related : [],
          path: `wiki/${type}/${f}`,
          raw,
        });
      } catch { /* ignore single file */ }
    }
  }
  return result;
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

// ============ 工具函数 ============

function parseStringArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.map((s) => String(s)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

module.exports = { answerQuestionStream };
