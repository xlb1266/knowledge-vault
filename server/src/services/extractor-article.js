/**
 * 微信公众号文章提取器
 *
 * 公众号是图文内容，yt-dlp 提取不了正文。这里直接 HTTP 抓 HTML 页面，
 * 用正则解析公众号稳定的 DOM 结构（id="activity-name" 标题、id="js_content" 正文等）。
 *
 * 不引入 cheerio：公众号 HTML 结构多年稳定，正则足够；且避免加重依赖。
 *
 * 合规说明：仅抓取公开可访问的公众号文章页面（无需登录即可打开的 /s/ 链接），
 * 不涉及私有内容、不绕过任何访问控制。
 */

const FETCH_TIMEOUT_MS = 30000;
const MAX_CONTENT_LEN = 8000; // 喂 AI 的正文上限，与字幕 6000 字同量级

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/**
 * 提取微信公众号文章正文
 * @param {string} url 公众号文章链接（mp.weixin.qq.com/s/xxx）
 * @returns {Promise<{title, author, description, contentText, thumbnail, sourceType}>}
 */
async function extractArticle(url) {
  const empty = {
    title: '',
    author: '',
    description: '',
    contentText: '',
    thumbnail: '',
    sourceType: 'wechat_article',
  };

  if (!url) return { ...empty, error: '无 URL' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return { ...empty, error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();
    return parseWechatHtml(html, url);
  } catch (err) {
    const msg = err.name === 'AbortError' ? '抓取超时(30s)' : err.message;
    return { ...empty, error: msg, timedOut: err.name === 'AbortError' };
  }
}

/**
 * 从公众号 HTML 解析标题、作者、正文
 */
function parseWechatHtml(html, url) {
  const result = {
    title: '',
    author: '',
    description: '',
    contentText: '',
    thumbnail: '',
    sourceType: 'wechat_article',
    url,
  };

  // 标题：优先 og:title，其次 activity-name
  const ogTitle = matchGroup(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const actName = matchGroup(html, /id=["']activity-name["'][^>]*>([^<]+)/i);
  result.title = cleanText(ogTitle || actName);

  // 公众号名：js_name
  const jsName = matchGroup(html, /id=["']js_name["'][^>]*>([^<]+)/i);
  result.author = cleanText(jsName);

  // 摘要：meta description
  const metaDesc = matchGroup(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  result.description = cleanText(metaDesc);

  // 封面：og:image
  const ogImage = matchGroup(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  result.thumbnail = ogImage || '';

  // 正文：id="js_content" 的 div 内容
  const contentHtml = extractContentBlock(html);
  result.contentText = htmlToText(contentHtml).slice(0, MAX_CONTENT_LEN);

  return result;
}

/**
 * 提取 id="js_content" 的块内容（处理嵌套 div 的最简方式：截取开始标签到对应层级结束）
 * 公众号正文结构：<div id="js_content" ...> ... </div>，通常后面紧跟 <!-- /等 -->
 * 取从开标签到文件中下一个 </div></div> 的区间已足够拿到正文文本。
 */
function extractContentBlock(html) {
  const startMatch = html.match(/id=["']js_content["'][^>]*>/i);
  if (!startMatch) return '';
  const startIdx = startMatch.index + startMatch[0].length;
  // 截取后面一段（正文一般不超过 100KB），用去标签法处理
  const chunk = html.slice(startIdx, startIdx + 200000);
  // 去掉尾部 </div> 之后的多余闭合（保留正文部分即可，htmlToText 会清理标签）
  return chunk;
}

/**
 * 粗暴但有效：去 HTML 标签 + 解码常见实体 + 压缩空白
 */
function htmlToText(html) {
  if (!html) return '';
  let text = html;
  // 去掉 script/style
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // <br> / <p> / </p> 换行
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<p[^>]*>/gi, '');
  // 去所有剩余标签
  text = text.replace(/<[^>]+>/g, '');
  // 解码常见 HTML 实体
  text = decodeEntities(text);
  // 压缩连续空白
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function matchGroup(str, regex) {
  const m = str.match(regex);
  return m && m[1] ? m[1] : '';
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

module.exports = { extractArticle, parseWechatHtml };
