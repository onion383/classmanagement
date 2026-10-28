"""
核对动态子集的 cmap 是否覆盖「实际会被绘制的全部字符」。
漏一个字 = PDF 里那块空白（jsPDF 不报错、不告警，所以只能靠这种逐字核对兜住）。

输入（由 testjs/smoke/pdf-subset-verify.mjs 产出）：
  testjs/tmp/subset-out.ttf        子集字体
  testjs/tmp/subset-text.txt       必须被覆盖的字符
  testjs/tmp/subset-text-excel.txt 同上（ExportExcel 路径）

跑法：python testjs/smoke/font-subset-verify.py
"""
import os
import sys

try:
    from fontTools.ttLib import TTFont
except ImportError:
    print('缺少 fontTools，无法校验。安装：pip install fonttools')
    print('（缺少时本脚本视为跳过，不算失败）')
    sys.exit(3)

# 脚本位于 testjs/smoke/，仓库根在上三级
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUBSET = os.path.join(ROOT, 'testjs/tmp/subset-out.ttf')


def main():
    if not os.path.exists(SUBSET):
        print('缺少子集文件，先跑 node testjs/smoke/pdf-subset-verify.mjs')
        print('（缺少产物时本脚本视为环境不具备，跳过而非失败）')
        return 3

    font = TTFont(SUBSET, lazy=True)
    cmap = font.getBestCmap()

    # name 表：合规要求子集后仍带版权（0）与许可（13/14）
    keep = {0: '版权', 1: '字体名', 2: '样式', 13: '许可', 14: '许可链接'}
    names = {}
    for rec in font['name'].names:
        if rec.nameID in keep and rec.nameID not in names:
            names[rec.nameID] = rec.toUnicode()[:60]
    print(f'子集字形数: {len(cmap)}')
    print('name 表保留情况:')
    for nid, label in keep.items():
        print(f'  [{nid:2d}] {label}: {"有" if nid in names else "缺"}   {names.get(nid, "")}')
    font.close()

    ok = True
    # 每条调用路径的文本不同，必须各自对应一份子集来核（不能拿 A 的子集去校验 B 的文本）
    for font_file, text_file in [
        ('subset-out.ttf', 'subset-text.txt'),
        ('subset-out-excel.ttf', 'subset-text-excel.txt'),
    ]:
        fp = os.path.join(ROOT, 'testjs/tmp', font_file)
        tp = os.path.join(ROOT, 'testjs/tmp', text_file)
        if not (os.path.exists(fp) and os.path.exists(tp)):
            continue
        f2 = TTFont(fp, lazy=True)
        cm2 = f2.getBestCmap()
        text = open(tp, encoding='utf-8').read()
        need = {c for c in text if ord(c) >= 0x20}
        miss = sorted(c for c in need if ord(c) not in cm2)
        print(f'\n{text_file} ← {font_file}: 需要 {len(need)} 个字符，缺 {len(miss)} 个')
        if miss:
            ok = False
            print(f'  缺失: {"".join(miss)}')
            print(f'  码位: {[hex(ord(c)) for c in miss]}')
        else:
            print('  全部覆盖')
        f2.close()
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
