/**
 * 微信公众号收藏采集适配器
 * 支持手动导入链接列表或批量链接解析
 */
async function collect(input) {
  const items = [];
  const { links, urls } = input || {};

  const allUrls = [
    ...(links || []).map((l) => (typeof l === 'string' ? { url: l } : l)),
    ...(urls || []).map((u) => ({ url: u })),
  ];

  for (const entry of allUrls) {
    items.push({
      title: entry.title || '',
      url: entry.url || '',
      author: entry.author || entry.mpName || '',
      description: entry.description || '',
      platform: 'wechat',
    });
  }

  return items;
}

function normalize(raw) {
  return {
    title: raw.title || raw['标题'] || '',
    url: raw.url || raw['链接'] || '',
    source_platform: 'wechat',
    source_author: raw.author || raw['作者'] || raw.mpName || '',
    summary: raw.description || raw['摘要'] || raw['内容'] || '',
  };
}

module.exports = { collect, normalize };
