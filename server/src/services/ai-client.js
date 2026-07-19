/**
 * AI client 共享模块（供 distill / qa 等新服务复用）
 *
 * 读取与 classifier-ai.js 相同的环境变量，独立初始化 OpenAI 兼容 client。
 * 不改动 classifier-ai.js（已验证、零回归风险）；未来可统一收敛到此。
 */

const OpenAI = require('openai');

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
      timeout: 120000,
    });
  }
  return client;
}

/**
 * 检查 AI 是否可用（key 已配置且不是占位符）
 */
function isAIAvailable() {
  if (!API_KEY) return false;
  const placeholderPatterns = ['填入', 'your', 'xxx', 'sk-xxx', 'placeholder'];
  const lower = API_KEY.toLowerCase();
  return !placeholderPatterns.some((p) => lower.includes(p));
}

module.exports = { getClient, isAIAvailable, MODEL, BASE_URL };
