// =========================================================================
// ExportAlbumIndex.builder.js —— 相册索引的行构建（纯函数，无副作用）
//
// 索引表结构固定为：序号 / 文件名 / 目录；
// 「索引分组」决定是否插子表标题行：
//   day    → 每天一个标题行（2026年3月2日）
//   month  → 每月一个标题行（2026年3月）
//   year   → 每年一个标题行（2026年）
//   none   → 不出标题行（即「文件顺序」，整表按文件名排一遍）
// 标题行复用 ExportExcel 已经支持的 type='globalRest' 行：Excel/HTML/PDF 里会渲染成
// 合并整行，CSV 会自动跳过，Markdown/文本/JSON 里落在第一格，不需要改导出组件的渲染逻辑。
// =========================================================================

import { naturalCollator } from '../../utils/collator.js'

// 索引表的固定三列（ExportExcel 的 fields 格式）
export const INDEX_FIELDS = [{ name: '序号' }, { name: '文件名' }, { name: '目录' }];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
// 月/年分组的键只有 2026-03 / 2026，不能复用带「日」的 DATE_RE
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^(\d{4})$/;

// 取文件所在目录：路径末段是文件名，去掉它（兼容 \ 与 / 混用）
// 边界：/a.jpg 的目录是 "/"（老实现 idx>0 不成立时整条路径都当目录）；
//       C:\a.jpg 的目录是 "C:\"（老实现会把盘符后面的反斜杠一起切掉，得到 "C:"）
export function dirOf(filePath) {
  const fp = String(filePath || '');
  const idx = Math.max(fp.lastIndexOf('\\'), fp.lastIndexOf('/'));
  if (idx < 0) return '';                        // 纯文件名，没有目录段
  if (idx === 0) return fp.slice(0, 1);          // 根目录（Unix / 或 UNC 前导符）
  if (idx === 2 && /^[a-zA-Z]:$/.test(fp.slice(0, 2))) return fp.slice(0, 3); // 盘符根 C:\
  return fp.slice(0, idx);
}

// 分组键：天=YYYY-MM-DD、月=YYYY-MM、年=YYYY；读不到拍摄时间的归到空串（渲染成「未知时间」）
export function groupKeyOf(photoDate, mode) {
  const d = String(photoDate || '').trim();
  if (!DATE_RE.test(d)) return '';
  if (mode === 'year') return d.slice(0, 4);
  if (mode === 'month') return d.slice(0, 7);
  return d.slice(0, 10);
}

// 分组键 → 子表标题文案（去掉前导 0，如 2026年3月2日）
export function formatGroupTitle(key, mode) {
  if (!key) return '未知时间';
  if (mode === 'year') {
    const y = key.match(YEAR_RE);
    return y ? `${y[1]}年` : key;
  }
  if (mode === 'month') {
    const m = key.match(MONTH_RE);
    return m ? `${m[1]}年${Number(m[2])}月` : key;
  }
  const m = key.match(DATE_RE);
  if (!m) return key;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

// 文件名自然排序（1.jpg < 2.jpg < 10.jpg）：用带 numeric 的比较器，
// 否则会排成 1、10、2。
// 比较器复用（不在比较器里每次调 localeCompare）—— 排序会调用 O(n log n) 次，
// 每次重建 Collator 纯属浪费。参数与原先的 localeCompare 调用保持一致。
function nameCompare(a, b) {
  return naturalCollator.compare(String(a || ''), String(b || ''));
}

/**
 * 构建索引行
 * @param {Array} albums  [{ id, name, photos: [{ file_name, file_path, photo_date }] }]
 * @param {'day'|'month'|'year'|'none'} mode 索引分组
 * @param {'asc'|'desc'} order 顺序（同时作用于分组顺序与组内文件顺序）
 * @returns {Array} ExportExcel 可直接消费的 rows
 */
export function buildIndexRows(albums, mode, order) {
  const dir = order === 'desc' ? -1 : 1;
  const list = Array.isArray(albums) ? albums : [];
  const multi = list.filter(a => (a.photos || []).length).length > 1;
  const rows = [];

  for (const album of list) {
    const photos = album.photos || [];
    if (!photos.length) continue;

    // 不分组的「文件顺序」：整册按文件名排一遍，序号连续
    if (mode === 'none') {
      if (multi) rows.push({ type: 'globalRest', label: `【${album.name}】` });
      const sorted = [...photos].sort((a, b) => dir * nameCompare(a.file_name, b.file_name));
      sorted.forEach((p, i) => {
        rows.push({ 序号: i + 1, 文件名: p.file_name || '', 目录: dirOf(p.file_path) });
      });
      continue;
    }

    // 按天/月/年分组：同一分组键落到同一子表，组内再按「日期 + 文件名」排序
    // （按天分组时组内日期都相同，等价于只按文件名；按月/年时不会把不同日期的文件混着只按名字排）
    const buckets = new Map();
    for (const p of photos) {
      const k = groupKeyOf(p.photo_date, mode);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    // 读不到拍摄时间的「未知时间」不论正序倒序都排最后，避免顶到表格最前面
    const keys = [...buckets.keys()].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return dir * nameCompare(a, b);
    });
    for (const k of keys) {
      // 多相册时标题带相册名，避免同一天在不同相册里出现两个一模一样的标题
      const prefix = multi ? `【${album.name}】` : '';
      rows.push({ type: 'globalRest', label: prefix + formatGroupTitle(k, mode) });
      const groupPhotos = [...buckets.get(k)].sort((a, b) => {
        const cmp = nameCompare(a.photo_date, b.photo_date) || nameCompare(a.file_name, b.file_name);
        return dir * cmp;
      });
      let n = 0;
      for (const p of groupPhotos) {
        rows.push({ 序号: ++n, 文件名: p.file_name || '', 目录: dirOf(p.file_path) });
      }
    }
  }
  return rows;
}
