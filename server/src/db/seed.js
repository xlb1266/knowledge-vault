const { getDb, run, all } = require('./index');

function seed() {
  const db = getDb();

  const existing = all('SELECT COUNT(*) as count FROM category_rules');
  if (existing[0]?.count > 0) {
    return;
  }

  const rules = [
    // ========== 排除规则 (纯娱乐) ==========
    ...['搞笑', '翻拍', '段子', '恶搞', '吃播', '挑战', '鬼畜', 'vlog', '日常'].map((kw) => ({
      rule_type: 'exclude', target_field: 'title', pattern: kw,
      category_l1: '', category_l2: '', category_l3: '', priority: 100,
    })),
    ...['综艺', '电视剧', '电影解说', '娱乐八卦', '明星', '饭圈'].map((kw) => ({
      rule_type: 'exclude', target_field: 'title', pattern: kw,
      category_l1: '', category_l2: '', category_l3: '', priority: 100,
    })),
    ...['游戏实况', '通关视频', '抽卡', '开箱'].map((kw) => ({
      rule_type: 'exclude', target_field: 'title', pattern: kw,
      category_l1: '', category_l2: '', category_l3: '', priority: 100,
    })),
    ...['社会新闻', '车祸', '纠纷', '情感故事'].map((kw) => ({
      rule_type: 'exclude', target_field: 'title', pattern: kw,
      category_l1: '', category_l2: '', category_l3: '', priority: 100,
    })),

    // ========== 包含规则 (有效知识) ==========
    ...['编程', '代码', 'Python', 'Java', '前端', '后端', '算法', '开源', 'GitHub'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '科学技术', category_l2: '计算机与编程', category_l3: '', priority: 50,
    })),
    ...['物理', '数学', '生物', '化学', 'AI', '机器学习', '航天'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '科学技术', category_l2: '', category_l3: '', priority: 50,
    })),
    ...['历史', '哲学', '经济学', '心理学', '社会学', '政治'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '人文社科', category_l2: '', category_l3: '', priority: 50,
    })),
    ...['面试', '简历', '职场', 'PPT', 'Excel', '效率工具'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '职业技能', category_l2: '', category_l3: '', priority: 50,
    })),
    ...['设计', '绘画', '摄影', '色彩', '字体', 'UI', 'UX', 'UI/UX'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '艺术设计', category_l2: '', category_l3: '', priority: 50,
    })),
    ...['英语', '日语', '语法', '单词', '发音'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '语言学习', category_l2: '', category_l3: '', priority: 50,
    })),
    ...['营养', '健身', '医学', '心理健康'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '健康生活', category_l2: '', category_l3: '', priority: 50,
    })),
    ...['投资', '股票', '基金', '理财', '保险'].map((kw) => ({
      rule_type: 'include', target_field: 'title', pattern: kw,
      category_l1: '商业财经', category_l2: '', category_l3: '', priority: 50,
    })),

    // ========== 分类规则 (精细匹配) ==========
    // 科学技术
    ...['编程语言', 'TypeScript', 'Rust', 'Go', 'C++'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '科学技术', category_l2: '计算机与编程', category_l3: '编程语言', priority: 30,
    })),
    ...['React', 'Vue', 'CSS', 'HTML', 'Webpack', 'Vite'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '科学技术', category_l2: '计算机与编程', category_l3: '前端开发', priority: 30,
    })),
    ...['Node', 'Docker', 'Kubernetes', '数据库', 'SQL', 'API'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '科学技术', category_l2: '计算机与编程', category_l3: '后端开发', priority: 30,
    })),
    ...['深度学习', '神经网络', 'NLP', 'CV', 'LLM', 'Transformer'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '科学技术', category_l2: '计算机与编程', category_l3: '人工智能', priority: 30,
    })),

    // 人文社科
    ...['考古', '文明', '朝代', '战争', '革命'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '人文社科', category_l2: '历史与考古', category_l3: '', priority: 30,
    })),
    ...['思维', '认知', '情绪', '行为'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '人文社科', category_l2: '心理与认知', category_l3: '', priority: 30,
    })),

    // 职业技能
    ...['项目管理', '敏捷', 'Scrum', '甘特图'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '职业技能', category_l2: '项目管理', category_l3: '', priority: 30,
    })),

    // 艺术设计
    ...['Figma', 'Sketch', '设计系统', '组件库'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '艺术设计', category_l2: 'UI/UX 设计', category_l3: '', priority: 30,
    })),

    // 健康生活
    ...['有氧', '力量训练', 'HIIT', '瑜伽'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '健康生活', category_l2: '运动健身', category_l3: '', priority: 30,
    })),
    ...['减脂', '增肌', '饮食计划', '营养素'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '健康生活', category_l2: '营养饮食', category_l3: '', priority: 30,
    })),

    // 商业财经
    ...['ETF', '定投', '止损', '资产配置'].map((kw) => ({
      rule_type: 'classify', target_field: 'title', pattern: kw,
      category_l1: '商业财经', category_l2: '投资理财', category_l3: '', priority: 30,
    })),
  ];

  for (const item of rules) {
    run(`
      INSERT INTO category_rules (rule_type, target_field, pattern, category_l1, category_l2, category_l3, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      item.rule_type,
      item.target_field,
      item.pattern,
      item.category_l1,
      item.category_l2,
      item.category_l3,
      item.priority,
    ]);
  }

  console.log(`✅ 种子数据已插入: ${rules.length} 条分类规则`);
}

module.exports = { seed };
