/**
 * B站采集适配器
 *
 * 注意：原一期通过逆向 api.bilibili.com 拉取收藏夹的逻辑已移除
 * （2026 年 B站对逆向 API 发律师函，bilibili-api-python / bilibili-API-collect
 *  两个主流项目已永久关停，继续使用有法律风险）。
 *
 * 现改为：用户手动提交视频链接 -> yt-dlp 提取元数据+字幕 -> AI 分类。
 * 内容解析由 services/extractor.js + services/classifier-ai.js 完成。
 */

function normalize(raw) {
  return {
    title: raw.title || raw['标题'] || '',
    url: raw.url || raw['链接'] || '',
    source_platform: 'bilibili',
    source_author: raw.author || raw['作者'] || '',
    summary: raw.description || raw['摘要'] || '',
  };
}

module.exports = { normalize };
