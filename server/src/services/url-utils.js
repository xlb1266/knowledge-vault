const https = require('https');
const http = require('http');

// 抖音/快手等分享口令里常见的 URL 正则（覆盖 http/https、含中文路径也能提取）
const URL_REGEX = /https?:\/\/[^\s一-龥，。、！！？：；""''（）【】《》]+/gi;

// 短链域名（需要重定向解析为真实 URL）
const SHORT_HOSTS = ['v.douyin.com', 'v.kuaishou.com', 'b23.tv'];

/**
 * 从分享口令文本中提取第一个 URL
 * 抖音分享格式举例："7.99 复制打开抖音，看看【xx】 https://v.douyin.com/iABC123/ 噪..."
 * @param {string} text
 * @returns {string} 提取到的 URL，找不到返回原 text（视为直接是 URL）
 */
function extractUrlFromText(text) {
  if (!text) return '';
  const trimmed = String(text).trim();
  const matches = trimmed.match(URL_REGEX);
  if (matches && matches.length > 0) {
    // 去掉尾部可能的标点
    return matches[0].replace(/[.,;:!?）)》""']+$/, '');
  }
  return trimmed;
}

/**
 * 判断 URL 是否为短链（需要重定向展开）
 */
function isShortUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SHORT_HOSTS.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

/**
 * 发起一次 HEAD/GET 请求，跟随重定向，返回最终落地 URL
 * 只跟随重定向，不下载 body，省流量
 * @param {string} url
 * @param {number} maxRedirects
 * @returns {Promise<string>} 最终 URL（失败时返回原 url）
 */
function resolveShortUrl(url, maxRedirects = 5) {
  return new Promise((resolve) => {
    if (!url || !isShortUrl(url)) {
      resolve(url);
      return;
    }

    let current = url;
    let redirects = 0;

    const doRequest = (target) => {
      if (redirects >= maxRedirects) {
        resolve(current);
        return;
      }

      const lib = target.startsWith('https') ? https : http;
      const req = lib.get(target, {
        method: 'GET', // 部分短链服务不支持 HEAD，用 GET 但立即销毁响应
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 8000,
      }, (res) => {
        // 拿到响应就立刻销毁，不读 body
        res.destroy();

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirects++;
          current = new URL(res.headers.location, target).href; // 处理相对路径重定向
          doRequest(current);
        } else {
          // 不再重定向，current 已是最终 URL
          resolve(current);
        }
      });

      req.on('error', () => resolve(current));
      req.on('timeout', () => {
        req.destroy();
        resolve(current);
      });
    };

    doRequest(current);
  });
}

/**
 * 综合处理：把分享口令/短链文本规范化为最终 URL
 * @param {string} text 原始输入（可能是口令文本、短链、完整 URL）
 * @returns {Promise<string>} 最终落地 URL
 */
async function normalizeShareUrl(text) {
  const url = extractUrlFromText(text);
  if (!url) return text || '';
  return resolveShortUrl(url);
}

module.exports = {
  extractUrlFromText,
  isShortUrl,
  resolveShortUrl,
  normalizeShareUrl,
};
