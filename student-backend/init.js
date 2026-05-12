function mapType(sqlType) {
  const t = sqlType.toLowerCase();
  if (t.includes('int')) return '整数';
  if (t.includes('real') || t.includes('float') || t.includes('double')) return '小数';
  if (t.includes('date') || t.includes('time')) return '日期';
  return '文字';
}
module.exports = { mapType };