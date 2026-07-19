/**
 * 小红书收藏采集适配器
 * 支持手动导入链接列表或 JSON/CSV 文件解析
 */
async function collect(input) {
  const items = [];
  const { links, jsonData, csvData } = input || {};

  // 链接列表导入
  if (links && Array.isArray(links)) {
    for (const link of links) {
      items.push({
        title: link.title || `小红书笔记 ${Date.now()}`,
        url: link.url || '',
        author: link.author || '',
        description: link.description || '',
        platform: 'xiaohongshu',
      });
    }
  }

  // JSON 数据
  if (jsonData && Array.isArray(jsonData)) {
    for (const entry of jsonData) {
      items.push({
        title: entry.title || entry.noteTitle || entry['笔记标题'] || '',
        url: entry.url || entry.shareLink || entry['分享链接'] || '',
        author: entry.author || entry.nickname || entry['作者'] || '',
        description: entry.desc || entry.description || entry['内容'] || '',
        platform: 'xiaohongshu',
      });
    }
  }

  // CSV 数据
  if (csvData && Array.isArray(csvData)) {
    for (const row of csvData) {
      items.push({
        title: row['标题'] || row['title'] || row['笔记标题'] || '',
        url: row['链接'] || row['url'] || row['笔记链接'] || '',
        author: row['作者'] || row['author'] || row['昵称'] || '',
        description: row['内容'] || row['description'] || row['正文'] || '',
        platform: 'xiaohongshu',
      });
    }
  }

  return items;
}

function normalize(raw) {
  return {
    title: raw.title || '',
    url: raw.url || '',
    source_platform: 'xiaohongshu',
    source_author: raw.author || '',
    summary: raw.description || '',
  };
}

module.exports = { collect, normalize };
