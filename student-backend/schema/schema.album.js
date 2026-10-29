// schema 拆分子文件：班级相册（相册表 / 照片索引表）+ 缩略图列、排序列迁移 + 索引。
function migrateAlbum(conn) {
  conn.exec(`
    -- 班级相册：相册（文件夹）登记表
    -- kind：'folder' 文件夹相册 / 'virtual' 虚拟相册
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'folder',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );

    -- 班级相册：照片索引表（记录源文件绝对路径与时间，用于按日期分组）
    -- exif_date：EXIF 里的原始拍摄时间（读不到为空）
    -- date_src：photo_date 的来源标记，'exif' / 'mtime'。
    --   增量扫描靠它判断「这行的日期是回退到 mtime 的，还是本来就取的 EXIF」——
    --   date_src 为空表示还没按 EXIF 核过，下次扫描会补读一次。
    -- thumb_v：缩略图生成时的尺寸/质量版本，默认 0 < 当前版本，老缩略图会在下次被请求时自动重建。
    CREATE TABLE IF NOT EXISTS album_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mtime TEXT DEFAULT '',
      photo_date TEXT DEFAULT '',
      exif_date TEXT DEFAULT '',
      date_src TEXT DEFAULT '',
      thumb_path TEXT DEFAULT '',
      thumb_v INTEGER DEFAULT 0,
      UNIQUE (album_id, file_path)
    );
  `);

  // 优化：相册照片按 (album_id, mtime) 排序展示，建索引避免大相册全表扫+排序（幂等）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_album_photos_album_mtime ON album_photos (album_id, mtime DESC);`);
  // 优化：时间轴按拍摄日期（photo_date，优先 EXIF）倒序分组展示，走这个索引
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_album_photos_album_date ON album_photos (album_id, photo_date DESC);`);

  // 扫描任务持久化（2026-10-22）：软件被关掉/崩溃时，正在跑的相册扫描会丢。
  // 这里把「进行中的扫描」落到库表，重启后可据此续扫，避免大相册从头再来。
  // - album_id 为主键：一个相册同时只有一个进行中的扫描。
  // - done_path 是断点：已成功处理到的最后一个文件路径（全量/增量都按「已处理完」推进）。
  //   续扫时重新收集文件清单，跳过 done_path 之前（含）的部分，从它的下一个继续。
  //   用「路径」而不是「序号」做断点，是因为重启后目录内容可能变化（文件被增删），
  //   序号会错位，路径则能稳定定位。
  // - phase 记录扫描走到哪一步：collect（收集清单）/ process（处理文件）。
  //   收集阶段被中断时清单没攒完，续扫要重新收集（done_path 为空即可表达）。
  // - state 表达任务的**运行态**，供跨进程协调（2026-10-22 起扫描跑在独立子进程里，
  //   主进程与子进程都靠这张表对齐状态，不再依赖各自内存里的 Map——跨进程看不见对方的内存）：
  //   running   —— 正在扫
  //   paused    —— 用户点了暂停
  //   cancelled —— 用户点了停止，子进程读到就收工
  // - token = 本次扫描的**归属标识**（每次派活生成一个新值）。
  //   为什么需要（跨进程写同一张表的所有权问题）：
  //   主进程与子进程都会写这一行。少了 token 就会出现「串行覆盖」：
  //   · 用户点停止 → 主进程写 state='cancelled'；
  //     但子进程随后执行 persistScanStart（无条件写 state='running'）→ 把停止指令抹掉，
  //     扫描照跑，用户以为停了其实没停。
  //   · 旧扫描收尾时执行 persistScanClear（DELETE）→ 顺手删掉新扫描刚写的行，
  //     新扫描读到「行不见了」就误判成被放弃而中止。
  //   带上 token 后，所有写操作都限定「只改属于我这一次的行」：
  //   UPDATE/DELETE ... WHERE album_id = ? AND token = ?
  //   互不干扰。
  conn.exec(`
    CREATE TABLE IF NOT EXISTS album_scan_tasks (
      album_id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'incremental',
      phase TEXT NOT NULL DEFAULT 'collect',
      done_path TEXT NOT NULL DEFAULT '',
      scanned INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'running',
      token INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
}

module.exports = { migrateAlbum };
