// 纯 JS 的 PDF DOM 全局补丁（替代 35MB 的 @napi-rs/canvas）
//
// 背景：pdf-parse → pdfjs-dist 在 Node 环境下需要一个文档级 DOMMatrix 实现来完成几何变换；
// 缺了它 getText() 会直接抛 "DOMMatrix is not defined"。此前该实现由 @napi-rs/canvas（Skia）
// 提供，但那份原生库（skia .node 25MB + icudtl.dat 10MB）只为这一个全局而来。
//
// 本应用只用 pdf-parse 做「PDF 文本提取」，不做任何渲染/取图，因此只需要 DOMMatrix 的
// 2D 变换能力，无需真正的画布。这里用一个纯 JS 的最小 2D 矩阵实现替代，从而可在打包时
// 整体剔除 @napi-rs/canvas（约 -35MB）。ImageData / Path2D 仅在渲染时才会用到，故不提供。
//
// 实测：与真 canvas 方案在「拉丁文本」与「内嵌 NotoSansSC 的中文 PDF」上提取结果逐字一致。

// 最小 2D 仿射矩阵（a,b,c,d,e,f），覆盖 pdfjs 文本提取所需的构造与变换运算
class DOMMatrix2D {
  constructor(init) {
    this._m = [1, 0, 0, 1, 0, 0];
    if (init) {
      if (typeof init === 'string') {
        const mm = init.match(/matrix\(([^)]*)\)/);
        if (mm) {
          const v = mm[1].split(',').map(Number);
          for (let i = 0; i < 6; i++) if (!Number.isNaN(v[i])) this._m[i] = v[i];
        }
      } else if (Array.isArray(init) || ArrayBuffer.isView(init)) {
        if (init.length === 6) {
          for (let i = 0; i < 6; i++) this._m[i] = +init[i];
        } else if (init.length === 16) {
          // 4x4 列主序：取 2D 分量
          this._m = [init[0], init[1], init[4], init[5], init[12], init[13]];
        }
      } else if (typeof init === 'object') {
        ['a', 'b', 'c', 'd', 'e', 'f'].forEach((k, i) => {
          if (init[k] !== undefined) this._m[i] = +init[k];
        });
      }
    }
  }

  get a() { return this._m[0] } set a(v) { this._m[0] = v }
  get b() { return this._m[1] } set b(v) { this._m[1] = v }
  get c() { return this._m[2] } set c(v) { this._m[2] = v }
  get d() { return this._m[3] } set d(v) { this._m[3] = v }
  get e() { return this._m[4] } set e(v) { this._m[4] = v }
  get f() { return this._m[5] } set f(v) { this._m[5] = v }

  get is2D() { return true }
  get isIdentity() {
    const m = this._m;
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
  }

  // this * other
  multiply(other) {
    const a = this._m;
    const b = other && other._m ? other._m : [other.a, other.b, other.c, other.d, other.e, other.f];
    return new DOMMatrix2D([
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ]);
  }

  preMultiply(other) {
    return new DOMMatrix2D(other).multiply(this);
  }

  translate(tx = 0, ty = 0) {
    return new DOMMatrix2D(this._m).multiply(new DOMMatrix2D([1, 0, 0, 1, tx, ty]));
  }

  scale(sx = 1, sy = sx) {
    return new DOMMatrix2D(this._m).multiply(new DOMMatrix2D([sx, 0, 0, sy, 0, 0]));
  }

  inverse() {
    const [a, b, c, d, e, f] = this._m;
    const det = a * d - b * c;
    if (!det) return new DOMMatrix2D();
    return new DOMMatrix2D([
      d / det, -b / det, -c / det, a / det,
      (c * f - d * e) / det, (b * e - a * f) / det,
    ]);
  }

  invertSelf() { this._m = this.inverse()._m; return this }
  multiplySelf(other) { this._m = this.multiply(other)._m; return this }
  preMultiplySelf(other) { this._m = this.preMultiply(other)._m; return this }
  translateSelf(tx = 0, ty = 0) { this._m = this.translate(tx, ty)._m; return this }
  scaleSelf(sx = 1, sy = sx) { this._m = this.scale(sx, sy)._m; return this }

  toString() { return `matrix(${this._m.join(', ')})` }
}

// 安装到全局（仅在缺失时，避免覆盖环境自带的实现）
function install() {
  const g = globalThis;
  if (typeof g.DOMMatrix === 'undefined') g.DOMMatrix = DOMMatrix2D;
  if (typeof g.DOMMatrixReadOnly === 'undefined') g.DOMMatrixReadOnly = DOMMatrix2D;
  if (typeof g.DOMPoint === 'undefined') {
    g.DOMPoint = class DOMPoint {
      constructor(x = 0, y = 0) { this.x = x; this.y = y }
    };
  }
}

install();

module.exports = { install, DOMMatrix2D };