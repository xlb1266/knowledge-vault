const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { extractArticle } = require('./extractor-article');

// yt-dlp 可执行文件路径：优先环境变量，否则用 server/bin 下的
const YTDLP_PATH = process.env.YTDLP_PATH || path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe');
const COOKIE_FILE = process.env.BILIBILI_COOKIE_FILE || path.join(__dirname, '..', '..', 'data', 'bilibili-cookie.txt');
const DOUYIN_COOKIE_FILE = process.env.DOUYIN_COOKIE_FILE || path.join(__dirname, '..', '..', 'data', 'douyin-cookie.txt');

// 单条视频提取超时（用户确认为 45 秒）
const EXTRACT_TIMEOUT_MS = 45000;

// 图文平台（走 HTTP 抓取正文，不走 yt-dlp）
const ARTICLE_PLATFORMS = ['wechat'];
// 视频平台（走 yt-dlp）
const VIDEO_PLATFORMS = ['bilibili', 'douyin', 'xiaohongshu'];

/**
 * 按平台内容类型分发提取
 * @param {string} url
 * @param {string} platform - source_platform
 * @returns {Promise<{title, author, description, contentText, thumbnail, sourceType}>}
 */
async function extractContent(url, platform) {
  if (!url) {
    return { title: '', author: '', description: '', contentText: '', thumbnail: '', sourceType: 'none' };
  }

  if (ARTICLE_PLATFORMS.includes(platform)) {
    const article = await extractArticle(url);
    return {
      title: article.title,
      author: article.author,
      description: article.description,
      contentText: article.contentText,
      thumbnail: article.thumbnail,
      sourceType: 'wechat_article',
    };
  }

  // 默认视频提取
  const video = await extractVideo(url, platform);
  // 视频正文 = 简介(description) + 字幕(subtitleText)
  // 多数视频无 CC 字幕（需 cookie），但简介通常有，避免正文为空
  const parts = [];
  if (video.description) parts.push(video.description);
  if (video.subtitleText) parts.push(video.subtitleText);
  return {
    title: video.title,
    author: video.author,
    description: video.description,
    contentText: parts.join('\n\n'),
    thumbnail: video.thumbnail,
    sourceType: 'video',
  };
}

/**
 * 提取视频的元数据 + 字幕（不下载视频本身）
 * @param {string} url - 视频链接
 * @param {string} [platform] - 平台，用于决定带哪个 cookie（bilibili/douyin）
 * @returns {Promise<{title, author, description, thumbnail, duration, subtitleText}>}
 */
function extractVideo(url, platform) {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-ytdlp-'));
    const outTemplate = path.join(tmpDir, '%(id)s');

    const args = [
      '--skip-download',
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '-o', outTemplate,
      '--write-subs',
      '--write-auto-subs',
      '--sub-format', 'srt',
      '--sub-lang', 'zh-Hans,zh-CN,zh,en',
    ];

    // cookie 文件存在则带上（B站 CC 字幕、抖音部分视频需要登录态）
    if (platform === 'douyin' && fs.existsSync(DOUYIN_COOKIE_FILE)) {
      args.push('--cookies', DOUYIN_COOKIE_FILE);
    } else if (fs.existsSync(COOKIE_FILE)) {
      args.push('--cookies', COOKIE_FILE);
    }

    args.push(url);

    const child = spawn(YTDLP_PATH, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 读取字幕文件
      try {
        result.subtitleText = readSubtitle(tmpDir);
      } catch {
        result.subtitleText = '';
      }
      // 清理临时目录
      cleanupDir(tmpDir);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        finish({
          title: '', author: '', description: '', thumbnail: '', duration: 0,
          subtitleText: '', timedOut: true,
        });
      }
    }, EXTRACT_TIMEOUT_MS);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', () => {
      // stdout 第一行是 JSON
      const jsonLine = stdout.split('\n').find((l) => l.trim().startsWith('{'));
      if (!jsonLine) {
        finish({
          title: '', author: '', description: '', thumbnail: '', duration: 0,
          subtitleText: '', error: stderr.slice(0, 200) || '无输出',
        });
        return;
      }
      try {
        const d = JSON.parse(jsonLine);
        finish({
          title: d.title || '',
          author: d.uploader || d.channel || '',
          description: d.description || '',
          thumbnail: d.thumbnail || '',
          duration: d.duration || 0,
          subtitleText: '',
        });
      } catch (err) {
        finish({
          title: '', author: '', description: '', thumbnail: '', duration: 0,
          subtitleText: '', error: `JSON 解析失败: ${err.message}`,
        });
      }
    });

    child.on('error', (err) => {
      finish({
        title: '', author: '', description: '', thumbnail: '', duration: 0,
        subtitleText: '', error: `yt-dlp 启动失败: ${err.message}`,
      });
    });
  });
}

/**
 * 从临时目录读取并解析 .srt 字幕为纯文本
 */
function readSubtitle(tmpDir) {
  const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.srt'));
  if (files.length === 0) return '';

  // 优先中文字幕
  const zhFile = files.find((f) => /zh|chi/i.test(f)) || files[0];
  const content = fs.readFileSync(path.join(tmpDir, zhFile), 'utf-8');

  // 去掉时间轴和序号，只留正文
  const lines = content.split(/\r?\n/);
  const textLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) continue;  // 序号
    if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) continue;  // 时间轴
    if (/-->/.test(trimmed)) continue;
    textLines.push(trimmed);
  }

  // 合并重复行（字幕常有重复）并截断
  const seen = new Set();
  const unique = [];
  for (const l of textLines) {
    if (!seen.has(l)) {
      seen.add(l);
      unique.push(l);
    }
  }
  return unique.join(' ').slice(0, 6000);
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

module.exports = { extractVideo, extractContent };
