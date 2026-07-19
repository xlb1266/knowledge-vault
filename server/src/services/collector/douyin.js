/**
 * 抖音收藏采集适配器
 * 支持手动导入链接列表或 CSV 文件解析
 */
async function collect(input) {
  const items = [];
  const { links, csvData } = input || {};

  // 链接列表导入
  if (links && Array.isArray(links)) {
    for (const link of links) {
      items.push({
        title: link.title || `抖音视频 ${Date.now()}`,
        url: link.url || '',
        author: link.author || '',
        description: link.description || '',
        platform: 'douyin',
      });
    }
  }

  // CSV/JSON 文件数据
  if (csvData && Array.isArray(csvData)) {
    for (const row of csvData) {
      items.push({
        title: row['标题'] || row['title'] || row['视频标题'] || '',
        url: row['链接'] || row['url'] || row['视频链接'] || '',
        author: row['作者'] || row['author'] || row['创作者'] || '',
        description: row['描述'] || row['description'] || row['简介'] || '',
        platform: 'douyin',
      });
    }
  }

  return items;
}

function normalize(raw) {
  return {
    title: raw.title || '',
    url: raw.url || '',
    source_platform: 'douyin',
    source_author: raw.author || '',
    summary: raw.description || '',
  };
}

module.exports = { collect, normalize };
