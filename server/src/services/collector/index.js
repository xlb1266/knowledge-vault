const bilibiliAdapter = require('./bilibili');
const douyinAdapter = require('./douyin');
const xiaohongshuAdapter = require('./xiaohongshu');
const wechatAdapter = require('./wechat');

const adapters = {
  bilibili: bilibiliAdapter,
  douyin: douyinAdapter,
  xiaohongshu: xiaohongshuAdapter,
  wechat: wechatAdapter,
};

/**
 * 将原始输入规范化为统一的 Item 数组
 * （B站逆向 API 拉取已移除，仅保留手动链接 / CSV 文件两种导入方式）
 * @param {string} platform - 平台标识
 * @param {object} input - { links: [], csvData: [] }
 * @returns {Array} 统一的 Item[]
 */
function routeToAdapter(platform, input) {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`不支持的平台: ${platform}`);
  }

  // 手动链接导入
  if (input.links && Array.isArray(input.links) && input.links.length > 0) {
    return input.links.map((link) => adapter.normalize({
      title: link.title || '',
      url: link.url || '',
      author: link.author || '',
      description: link.description || '',
    }));
  }

  // CSV/JSON 文件导入
  if (input.csvData && Array.isArray(input.csvData)) {
    return input.csvData.map((row) => adapter.normalize(row));
  }

  return [];
}

module.exports = { routeToAdapter };
