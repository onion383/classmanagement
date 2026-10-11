# 班集

一款面向班级日常管理的桌面应用。数据全部保存在本机，不依赖云服务。

## 功能

| 模块 | 说明 |
| --- | --- |
| 首页 | 概览与快捷入口 |
| 班级管理 | 学生名单与基础信息维护 |
| 座位表 | 网状座位编排、拖拽交换、区域选择 |
| 课程表 | 课程安排与时段管理 |
| 值日 | 值日轮换与安排 |
| 分组管理 | 分组与成员管理 |
| 活动 | 活动记录与统计 |
| 成绩 | 成绩录入与查询 |
| 请假 | 请假记录管理 |
| 收费 | 收费项目与记录 |
| 相册 | 图片/视频管理（含缩略图、转码） |
| AI 助手 | 内置智能助手 |
| 桌面小组件 | 独立浮窗/桌面组件，可单独配置 |
| 通用表格 | 单元格编辑、右键菜单、剪切粘贴、去重、导入导出（Excel / CSV / PDF / HTML） |
| 设置 | 主题、背景、数据目录、账号、数据库导出/迁移 |

## 技术栈

- **桌面端**：Electron 43，自定义 `app://` 安全协议加载前端，系统亚克力材质 + 无边框窗口，托盘常驻、单实例运行。
- **前端**：Vue 3 + Vite 8 + Tailwind CSS 4 + Pinia + Vue Router；内置 4 套主题（`glass` / `glass2` / `win11` / `minimal`）。
- **后端**：Node.js + Express 5，由主进程 `child_process.fork` 拉起为子进程。
- **数据**：本地加密 SQLite（`better-sqlite3-multiple-ciphers`），主密钥经 Electron `safeStorage` 加解密。
- **打包**：electron-builder + Inno Setup。

## 开发文档

各文件职责与架构说明见 **[doc/开发文档总览.md](doc/开发文档总览.md)**（开发文档总索引）：

- [Electron 主进程开发文档](doc/主进程/主进程.md)
- [后端开发文档](doc/后端/后端.md)
- [前端开发文档](doc/前端/前端总览.md)（含 [页面](doc/前端/页面.md) / [组件](doc/前端/组件.md) / [组合式](doc/前端/组合式函数.md) / [其他](doc/前端/其他.md)）
- [小组件文档](doc/小组件.md)（工具箱浮窗 + 桌面小组件）
- [优化文档](doc/优化文档.md)（打包体积 / 磁盘 / 内存 / 首批加载 / 切换性能）

## 目录结构

```
project-name/
├── electron/                 # Electron 主进程
│   ├── main.js               # 主进程入口
│   ├── preload.js            # 预加载脚本（IPC 通道白名单）
│   ├── main/                 # 主进程模块（backend / perf / tray / widget / updater / ...）
│   ├── inno/                 # Inno Setup 安装包脚本
│   └── afterPack.js          # 打包后精简（剔除无用文件）
├── student-frontend/         # Vue 3 前端
│   └── src/
│       ├── views/            # 页面
│       ├── components/       # 组件（表格、网格、弹窗、布局等）
│       ├── composables/      # 组合式逻辑（通用表格 CRUD、座位网格等）
│       ├── stores/           # Pinia 状态
│       ├── styles/           # 全局样式与主题
│       └── router/           # 路由
├── student-backend/          # Node/Express 后端（fork 为子进程运行）
│   ├── app.js                # 后端入口
│   ├── routes/               # 各业务路由
│   ├── services/             # 服务层（表服务、加密通道、FFmpeg、恢复密钥等）
│   ├── middleware/           # 鉴权中间件
│   └── db.js / schema.js     # 数据库连接与表结构
├── doc/                      # 开发文档（各文件职责与架构）
├── electron-builder.json     # 打包配置
└── package.json
```

## 环境要求

- Windows（当前主要目标平台）
- Node.js LTS（Vite 8 对 Node 版本有要求，建议 20 及以上）
- 依赖中包含原生模块（`better-sqlite3-multiple-ciphers`），已通过 `@electron/rebuild` 针对 Electron ABI 重编译；**目标机无需安装 Node.js**

## 快速开始

安装依赖（`postinstall` 会自动安装 `student-backend` 的依赖）：

```bash
npm install
```

开发模式（同时启动 Vite 与 Electron）：

```bash
npm run electron:dev
```

仅启动前端开发服务器：

```bash
npm run dev
```

## 构建与打包

```bash
# 只构建前端产物
npm run build

# 构建前端 + electron-builder 打包 + 生成 Inno Setup 安装包
npm run electron:build

# 仅生成 Inno Setup 安装包（需先完成 electron-builder 打包）
npm run build:win:inno
```

> 打包前建议清理编译缓存（`node_modules/.cache`）后再执行构建命令。

## 环境变量

项目根目录 `.env`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BACKEND_PORT` | `3000` | 后端服务端口 |
| `FRONTEND_PORT` | `5173` | 前端开发服务器端口 |

## 说明

- 后端在开发模式下从 `student-backend/` 目录启动，打包后从 `app.asar.unpacked/student-backend` 启动（该目录不参与 asar 打包，以便原生模块与子进程正常运行）。
- FFmpeg 随安装包一同分发，用于相册视频处理。
- 交互性能测量脚本：`npm run inp`（需以 `INP_DEBUG=1` 启动应用开启远程调试端口）。

## 许可

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE.md)，仅限非商业用途。