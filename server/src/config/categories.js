/**
 * 分类层级定义（3级）
 * 与分类规则 seed 数据保持一致的结构
 */
const categoryTree = {
  '科学技术': {
    order: 1,
    children: {
      '计算机与编程': {
        order: 1,
        children: ['编程语言', '前端开发', '后端开发', '人工智能'],
      },
      '数学与逻辑': { order: 2, children: [] },
      '物理与工程': { order: 3, children: [] },
      '生物与医学': { order: 4, children: [] },
      '航天与天文': { order: 5, children: [] },
    },
  },
  '人文社科': {
    order: 2,
    children: {
      '历史与考古': { order: 1, children: [] },
      '哲学与思想': { order: 2, children: [] },
      '心理与认知': { order: 3, children: [] },
      '经济与商业': { order: 4, children: [] },
      '社会与政治': { order: 5, children: [] },
      '法律与法规': { order: 6, children: [] },
    },
  },
  '职业技能': {
    order: 3,
    children: {
      '求职面试': { order: 1, children: [] },
      '办公效率': { order: 2, children: [] },
      '项目管理': { order: 3, children: [] },
      '沟通表达': { order: 4, children: [] },
      '创业管理': { order: 5, children: [] },
    },
  },
  '艺术设计': {
    order: 4,
    children: {
      'UI/UX 设计': { order: 1, children: [] },
      '平面与视觉': { order: 2, children: [] },
      '摄影与后期': { order: 3, children: [] },
      '绘画与插画': { order: 4, children: [] },
    },
  },
  '健康生活': {
    order: 5,
    children: {
      '运动健身': { order: 1, children: [] },
      '营养饮食': { order: 2, children: [] },
      '心理健康': { order: 3, children: [] },
      '医学科普': { order: 4, children: [] },
    },
  },
  '语言学习': {
    order: 6,
    children: {
      '英语': { order: 1, children: [] },
      '日语': { order: 2, children: [] },
      '其他语种': { order: 3, children: [] },
      '学习方法论': { order: 4, children: [] },
    },
  },
  '商业财经': {
    order: 7,
    children: {
      '投资理财': { order: 1, children: [] },
      '商业案例': { order: 2, children: [] },
      '市场分析': { order: 3, children: [] },
      '个人财务': { order: 4, children: [] },
    },
  },
};

/**
 * 将 categoryTree 转为 API 所需的树形数组
 */
function buildTree() {
  return Object.entries(categoryTree)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name, info]) => ({
      name,
      children: Object.entries(info.children)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([childName, childInfo]) => ({
          name: childName,
          children: childInfo.children.map((grand) => ({ name: grand, children: [] })),
        })),
    }));
}

module.exports = { categoryTree, buildTree };
