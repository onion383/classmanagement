#!/usr/bin/env bash
# =============================================================================
# 本项目专用 FFmpeg 精简构建脚本
#
# 产出：ffmpeg.exe（LGPL v2.1-or-later），仅用于「相册视频抽帧生成封面」。
#
# 许可合规要点（勿修改，改动前请先读本节）：
#   1. 不启用 --enable-gpl / --enable-nonfree / --enable-version3
#      → 结果为 LGPL v2.1-or-later，不含任何 GPL 组件。
#   2. 不链接任何外部库（--disable-autodetect 阻止 configure 自动探测并启用
#      构建机上碰巧存在的外部库——这是「意外引入 GPL」最常见的入口）。
#      所用的 h264 / hevc / vp9 / av1 解码器全部是 FFmpeg 自带原生实现，
#      不依赖 x264 / x265 / xvid 等 GPL-only 外部库。
#   3. ffmpeg.exe 以「独立进程 + 命令行」方式被主程序调用，不与主程序链接，
#      因此 LGPL 不会向主程序传导。
#
# 本脚本属 LGPL 定义的 "Corresponding Source"（用于控制编译和安装的脚本），
# 必须与 ffmpeg.exe 一并提供。许可全文见同目录 COPYING.LGPLv2.1。
#
# 用法：
#   SRC_TARBALL=/path/to/ffmpeg-8.1.3.tar.xz ./build.sh
#
# 可选环境变量：
#   WORK_DIR   构建工作区（默认 <脚本目录>/ffbuild-work，建议指到仓库外）
#   OUT_DIR    产物输出目录（默认 $WORK_DIR/out）
#   JOBS       并行编译任务数（默认 8）
#   MINGW_BIN  mingw-w64 工具链 bin 目录，可含多个（冒号分隔）。
#              注意：务必用不含空格的路径（Windows 上建议 8.3 短路径，如 C:/PROGRA~2/mingw64/bin），
#              否则 windres 内部调用 gcc 时会因路径含空格而失败。
#   SRC_DIR    复用已解压的源码目录（离线/无 xz 环境用），给出则跳过 tarball 解压
# =============================================================================
set -euo pipefail

FFMPEG_VERSION=8.1.3
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="${WORK_DIR:-$HERE/ffbuild-work}"
OUT_DIR="${OUT_DIR:-$WORK_DIR/out}"
JOBS="${JOBS:-8}"
SRC_TARBALL="${SRC_TARBALL:-}"
SRC_DIR="${SRC_DIR:-}"
BUILD_DIR="$WORK_DIR/build"

if [ -n "${MINGW_BIN:-}" ]; then export PATH="$MINGW_BIN:$PATH"; fi

if [ -n "$SRC_DIR" ] && [ -x "$SRC_DIR/configure" ]; then
  echo ">>> 复用已解压源码：$SRC_DIR"
  mkdir -p "$WORK_DIR"
  rm -rf "$BUILD_DIR"
else
  if [ -z "$SRC_TARBALL" ] || [ ! -f "$SRC_TARBALL" ]; then
    echo "错误：请用 SRC_TARBALL 指定 ffmpeg-${FFMPEG_VERSION}.tar.xz 的完整路径，" >&2
    echo "      或用 SRC_DIR 指定已解压的源码目录。" >&2
    echo "官方下载：https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" >&2
    exit 1
  fi
  SRC_DIR="$WORK_DIR/ffmpeg-${FFMPEG_VERSION}"
  echo ">>> 解压源码"
  rm -rf "$WORK_DIR"
  mkdir -p "$WORK_DIR"
  tar -xf "$SRC_TARBALL" -C "$WORK_DIR"
  chmod +x "$SRC_DIR/configure"
fi

# 校验源码确实是该版本的官方 release tarball（git 快照不含 RELEASE 文件）
RELEASE_FILE="$SRC_DIR/RELEASE"
if [ ! -f "$RELEASE_FILE" ] || [ "$(tr -d ' \r\n' < "$RELEASE_FILE")" != "$FFMPEG_VERSION" ]; then
  echo "错误：源码 RELEASE 文件不是 ${FFMPEG_VERSION}，可能不是官方 release tarball。" >&2
  exit 1
fi

echo ">>> configure（LGPL-only，不含 gpl/nonfree）"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
"$SRC_DIR/configure" \
  --target-os=mingw32 \
  --arch=x86_64 \
  --enable-static --disable-shared --disable-autodetect \
  --disable-network --disable-debug \
  --disable-doc --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages \
  --disable-programs --enable-ffmpeg --disable-ffplay --disable-ffprobe \
  --disable-everything \
  --enable-demuxer=mov,matroska,avi,asf,flv,mpegts,mpegps,ogg,gif,image2,rm \
  --enable-decoder=h264,hevc,mpeg4,mpeg2video,mpeg1video,mjpeg,prores,vc1,wmv3,wmv2,wmv1,msmpeg4v3,msmpeg4v2,flv,h263,h263p,rv30,rv40,theora,dvvideo,vp8,vp9,av1,svq1,svq3,cinepak,indeo3,gif \
  --enable-parser=h264,hevc,mpeg4video,mpegvideo,vc1,vp3,vp9,av1,mjpeg,ac3,dca,gif \
  --enable-encoder=mjpeg \
  --enable-muxer=image2,image2pipe \
  --enable-filter=scale,format,null,setpts,trim,crop,transpose,fps,buffersrc,buffersink \
  --enable-protocol=file \
  --disable-iconv --disable-bzlib --disable-zlib --disable-lzma --disable-x86asm \
  --extra-ldflags=-static

# --- mingw 原生工具链适配（仅在 Windows + 原生 make/gcc 下需要）---
# configure 由 POSIX shell 运行，产物会把源码路径记为 /d/... 形式；原生 mingw 的 make/gcc
# 不识别该形式，需改写为 Windows 形式（/d/x -> D:/x）。在 MSYS2 等一致环境下不触发。
if grep -q '^SRC_PATH=/' "$BUILD_DIR/ffbuild/config.mak" 2>/dev/null; then
  SRC_PATH_WIN="$(printf '%s' "$SRC_DIR" | sed -E 's#^/([a-zA-Z])/#\1:/#')"
  echo ">>> mingw 路径规范化：$SRC_DIR -> $SRC_PATH_WIN"
  sed -i "s#^SRC_PATH=.*#SRC_PATH=$SRC_PATH_WIN#; s#^SRC_LINK=.*#SRC_LINK=$SRC_PATH_WIN#" "$BUILD_DIR/ffbuild/config.mak"
  sed -i "s#^include .*#include $SRC_PATH_WIN/Makefile#" "$BUILD_DIR/Makefile"
fi

echo ">>> 编译"
make -j"$JOBS"

echo ">>> 落盘 + strip"
mkdir -p "$OUT_DIR"
cp "$BUILD_DIR/ffmpeg.exe" "$OUT_DIR/ffmpeg.exe"
strip "$OUT_DIR/ffmpeg.exe"

echo ">>> 完成"
ls -l "$OUT_DIR/ffmpeg.exe"
"$OUT_DIR/ffmpeg.exe" -version | head -n 3