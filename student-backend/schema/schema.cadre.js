// schema 拆分子文件：班干部（职务树 / 任职成员）+ 外键索引。
function migrateCadre(conn) {
  // ======================== 班干部 ========================
  // cadres：职务树节点。parent_id=0 表示顶级（直接挂在根下，如班主任/班长）。
  // cadre_members：职务的担任学生（一个职务可多人，一人也可任多职）。
  conn.exec(`
    CREATE TABLE IF NOT EXISTS cadres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER NOT NULL DEFAULT 0,
      max_count INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cadre_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cadre_id INTEGER NOT NULL,
      student_id INTEGER,
      student_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    -- 优化：按职务 id 取成员（列表接口每个职务一条查询），外键列建索引，幂等
    CREATE INDEX IF NOT EXISTS idx_cadre_members_cadre ON cadre_members (cadre_id, sort_order, id);
  `);
}

module.exports = { migrateCadre };
