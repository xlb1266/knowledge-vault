const OpenAI = require('openai');
const { buildTree } = require('../config/categories');

// 从环境变量读取配置
const API_KEY = process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.AI_BASE_URL || 'https://api.siliconflow.cn/v1';
const MODEL = process.env.AI_MODEL || 'Qwen/Qwen3-8B';

let client = null;
function getClient() {
  if (!client) {
    if (!API_KEY) return null;
    client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      maxRetries: 0,
      timeout: 80000,
    });
  }
  return client;
}

// 缓存分类树文本，避免每次调用都构造
let categoryTreeText = '';
function getCategoryTreeText() {
  if (categoryTreeText) return categoryTreeText;
  const tree = buildTree();
  const lines = [];
  for (const l1 of tree) {
    lines.push(`- ${l1.name}`);
    for (const l2 of l1.children) {
      lines.push(`  - ${l2.name}`);
      for (const l3 of l2.children) {
        lines.push(`    - ${l3.name}`);
      }
    }
  }
  categoryTreeText = lines.join('\n');
  return categoryTreeText;
}

/**
 * 检查 AI 是否可用（key 是否配置且不是占位符）
 */
function isAIAvailable() {
  if (!API_KEY) return false;
  const placeholderPatterns = ['填入', 'your', 'xxx', 'sk-xxx', 'placeholder'];
  const lower = API_KEY.toLowerCase();
  return !placeholderPatterns.some((p) => lower.includes(p));
}

/**
 * 带超时的 AI 分类（兜底 90 秒，避免单条内容卡太久）
 * @param {object} item - { title, author, description, contentText, platform }
 *   contentText 统一指正文内容（视频字幕 / 公众号正文 / 小红书正文）
 * @returns {Promise<{category_l1, category_l2, category_l3, summary, tags, is_valid, filter_reason, ai_source}>}
 */
async function classifyByAI(item) {
  return Promise.race([
    classifyByAIRaw(item),
    new Promise((_, reject) => setTimeout(() => reject(new Error('AI 调用超时(90s)')), 90000)),
  ]);
}

async function classifyByAIRaw(item) {
  const openai = getClient();
  if (!openai) {
    throw new Error('AI 未配置（缺 SILICONFLOW_API_KEY）');
  }

  // 组装内容文本：标题 + 作者 + 简介 + 正文/字幕
  // 根据内容量标记来源，便于追溯 AI 结论的依据是否充分
  const contentText = item.contentText || item.subtitleText || '';
  const contentLen = contentText.length;
  let aiSource = 'title_only';
  if (contentLen >= 200) aiSource = 'full_content';
  else if (contentLen > 0) aiSource = 'partial_content';

  const contentLabel = item.platform === 'wechat' ? '正文内容' : '字幕/正文内容';

  const contentParts = [
    `标题：${item.title || '(无)'}`,
    item.author ? `作者：${item.author}` : '',
    item.description ? `简介：${item.description.slice(0, 500)}` : '',
    contentText ? `${contentLabel}：${contentText.slice(0, 6000)}` : '',
  ].filter(Boolean);

  const systemPrompt = `你是一个知识库分类助手。根据内容的标题、简介和正文/字幕，判断它是否为有价值的知识内容，并从给定分类树中选择最合适的三级分类。

分类树：
${getCategoryTreeText()}

判断规则：
1. 纯娱乐内容（搞笑、段子、综艺、游戏实况、vlog 日常等）标记 is_valid=false
2. 有学习/知识价值的标记 is_valid=true
3. 分类必须从上面的分类树中选，不能自己编造
4. 如果找不到合适的分类，category 全部留空字符串
5. 用中文返回，tags 是 2-5 个关键词标签
6. 如果只有标题信息、正文为空，置信度可能较低，但仍需尽力分类
7. description 字段用于知识库问答助手的检索预筛：包含主题、3-6个关键概念、适用查询场景。问答助手会先扫所有文件的 description 判断相关性，命中才读正文。要信息密集、便于检索匹配。

只返回 JSON，不要任何解释文字：
{"category_l1":"...","category_l2":"...","category_l3":"...","summary":"50字以内的内容摘要","description":"主题+3-6个关键概念+适用查询场景，50-100字，供检索预筛","tags":["tag1","tag2"],"is_valid":true,"filter_reason":""}`;

  const userPrompt = contentParts.join('\n');

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 800,
    // Qwen3 是推理模型，关闭思考过程以省 token、加速响应
    enable_thinking: false,
  });

  const text = completion.choices[0]?.message?.content || '';
  const parsed = parseAIResponse(text);
  // 置信度：基于内容来源推断（可被 AI 返回值覆盖）
  const inferredConfidence = aiSource === 'full_content' ? 'high' : aiSource === 'partial_content' ? 'medium' : 'low';
  return {
    ...parsed,
    ai_source: aiSource,
    ai_confidence: parsed.ai_confidence || inferredConfidence,
  };
}

/**
 * 从 LLM 返回文本中提取 JSON
 */
function parseAIResponse(text) {
  let cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      category_l1: parsed.category_l1 || '',
      category_l2: parsed.category_l2 || '',
      category_l3: parsed.category_l3 || '',
      summary: parsed.summary || '',
      description: parsed.description || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      is_valid: parsed.is_valid === true || parsed.is_valid === 'true' ? 1 : 0,
      filter_reason: parsed.is_valid === false ? (parsed.filter_reason || 'AI 判定为非知识内容') : '',
      ai_confidence: parsed.ai_confidence || '',
    };
  } catch (err) {
    throw new Error(`AI 返回 JSON 解析失败: ${err.message}`);
  }
}

module.exports = { classifyByAI, isAIAvailable };
