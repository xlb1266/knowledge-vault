const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'knowledge.db');

let SQL;
let db;

/**
 * 异步初始化数据库（在服务器启动前调用一次）
 */
async function initDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!SQL) {
    SQL = await initSqlJs();
  }

  // 如果数据库文件存在，从文件加载
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  initTables();
  saveDatabase();
  return db;
}

/**
 * 同步获取已初始化的数据库实例
 */
function getDb() {
  if (!db) {
    throw new Error('数据库尚未初始化，请先调用 initDb()');
  }
  return db;
}

/**
 * 将内存数据库持久化到文件
 */
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

/**
 * 旧库迁移：给 knowledge_entries 补齐阶段二新增的列
 * CREATE TABLE IF NOT EXISTS 对已存在的表不生效，所以单独 ALTER ADD COLUMN
 * （检测列名，已存在则跳过，保证可重复执行）
 */
function migrateSchema() {
  const NEW_COLUMNS = [
    'content_text TEXT DEFAULT \'\'',
    'content_hash TEXT DEFAULT \'\'',
    'ai_source TEXT DEFAULT \'\'',
    'ai_confidence TEXT DEFAULT \'\'',
    'description TEXT DEFAULT \'\'',
    'md_path TEXT DEFAULT \'\'',
  ];

  // 读取现有列名
  const rows = all(`PRAGMA table_info(knowledge_entries)`);
  const existingCols = new Set(rows.map((r) => r.name));

  for (const colDef of NEW_COLUMNS) {
    const colName = colDef.split(' ')[0];
    if (!existingCols.has(colName)) {
      db.run(`ALTER TABLE knowledge_entries ADD COLUMN ${colDef}`);
      existingCols.add(colName);
    }
  }

  // 回填 md_path：扫描 kb-wiki/raw/articles/*.md，读 frontmatter 的 id，映射到对应条目
  // 让历史 md（无 md_path 记录的）也能被重新提取覆盖，而非生成重复文件
  backfillMdPath();
}

/**
 * 回填 md_path：扫描已生成的 .md 文件，按 frontmatter 的 id 建立映射
 */
function backfillMdPath() {
  const fs = require('fs');
  const path = require('path');
  const articlesDir = path.join(__dirname, '..', '..', 'data', 'kb-wiki', 'raw', 'articles');
  if (!fs.existsSync(articlesDir)) return;

  const files = fs.readdirSync(articlesDir).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(articlesDir, f), 'utf-8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) continue;
      const idMatch = fm[1].match(/^id:\s*(\d+)/m);
      if (!idMatch) continue;
      const id = Number(idMatch[1]);
      const relPath = `raw/articles/${f}`;
      // 只在 md_path 为空时回填（不覆盖已有映射）
      const existing = get('SELECT md_path FROM knowledge_entries WHERE id = ?', [id]);
      if (existing && !existing.md_path) {
        db.run('UPDATE knowledge_entries SET md_path = ? WHERE id = ?', [relPath, id]);
      }
    } catch { /* ignore single file errors */ }
  }
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT,
      source_platform TEXT NOT NULL,
      source_author TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      category_l1 TEXT DEFAULT '',
      category_l2 TEXT DEFAULT '',
      category_l3 TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      is_valid INTEGER DEFAULT 1,
      filter_reason TEXT DEFAULT '',
      collected_at TEXT,
      content_text TEXT DEFAULT '',
      content_hash TEXT DEFAULT '',
      ai_source TEXT DEFAULT '',
      ai_confidence TEXT DEFAULT '',
      description TEXT DEFAULT '',
      md_path TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 旧库迁移：对已存在的表补齐新增列（CREATE TABLE IF NOT EXISTS 不会改旧表）
  migrateSchema();

  db.run(`
    CREATE TABLE IF NOT EXISTS collect_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_platform TEXT NOT NULL,
      item_count INTEGER DEFAULT 0,
      valid_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      error_message TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_type TEXT NOT NULL,
      target_field TEXT DEFAULT 'title',
      pattern TEXT NOT NULL,
      category_l1 TEXT DEFAULT '',
      category_l2 TEXT DEFAULT '',
      category_l3 TEXT DEFAULT '',
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_entries_platform ON knowledge_entries(source_platform);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_entries_valid ON knowledge_entries(is_valid);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_entries_cat ON knowledge_entries(category_l1, category_l2);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rules_type ON category_rules(rule_type, enabled);`);
}

// ============ 辅助查询函数（兼容 better-sqlite3 风格的同步 API）============

/**
 * 执行写操作（INSERT/UPDATE/DELETE）并持久化
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  const result = get('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid');
  return {
    changes: result?.changes || 0,
    lastInsertRowid: result?.lastInsertRowid,
  };
}

/**
 * 查询返回数组（兼容命名参数：传入对象时按 $key 绑定，传入数组时按位置绑定）
 */
function all(sql, params) {
  const stmt = db.prepare(sql);
  const values = Array.isArray(params) ? params : params ? objectToValues(stmt, params) : [];
  stmt.bind(values);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

/**
 * 查询返回单个对象
 */
function get(sql, params) {
  const stmt = db.prepare(sql);
  const values = Array.isArray(params) ? params : params ? objectToValues(stmt, params) : [];
  stmt.bind(values);
  const result = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return result;
}

/**
 * sql.js 不支持命名参数绑定，这里把对象转成按位置数组
 * 通过解析 SQL 中的 $key/@key 占位符顺序提取
 */
function objectToValues(stmt, params) {
  // sql.js 的 stmt.params 返回参数名数组（如果使用命名参数）
  const paramNames = stmt.paramsName ? stmt.paramsName() : null;
  if (paramNames && paramNames.length > 0) {
    return paramNames.map((name) => {
      // 去掉前缀 $ 或 @ 或 :
      const key = name.replace(/^[$@:]/, '');
      return params[key];
    });
  }
  return Object.values(params);
}

module.exports = { initDb, getDb, run, all, get, saveDatabase };
