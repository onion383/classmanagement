// schema 拆分子文件：班级相册（相册表 / 照片索引表）+ 缩略图列、排序列迁移 + 索引。
function migrateAlbum(conn) {
  conn.exec(`
    -- 班级相册：相册（文件夹）登记表
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );

    -- 班级相册：照片索引表（记录源文件绝对路径与时间，用于按日期分组）
    CREATE TABLE IF NOT EXISTS album_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mtime TEXT DEFAULT '',
      photo_date TEXT DEFAULT '',
      thumb_path TEXT DEFAULT '',
      UNIQUE (album_id, file_path)
    );
  `);

  // 存量库迁移：为相册照片表补充 thumb_path 列
  {
    const photoCols = conn.prepare('PRAGMA table_info(album_photos)').all().map(c => c.name);
    if (!photoCols.includes('thumb_path')) {
      conn.exec(`ALTER TABLE album_photos ADD COLUMN thumb_path TEXT DEFAULT ''`);
    }
  }
  // 优化：相册照片按 (album_id, mtime) 排序展示，建索引避免大相册全表扫+排序（幂等）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_album_photos_album_mtime ON album_photos (album_id, mtime DESC);`);
  // 存量库迁移：为相册表补充 sort_order 列
  {
    const albumCols = conn.prepare('PRAGMA table_info(albums)').all().map(c => c.name);
    if (!albumCols.includes('sort_order')) {
      conn.exec(`ALTER TABLE albums ADD COLUMN sort_order INTEGER DEFAULT 0`);
      // 已有数据按 id 序填充 sort_order
      conn.exec(`UPDATE albums SET sort_order = id WHERE sort_order = 0`);
    }
  }
}

module.exports = { migrateAlbum };
