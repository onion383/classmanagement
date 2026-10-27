# testjs

开发期辅助脚本集合。**都不参与打包**，也不被应用代码引用。

## 目录约定

| 目录 | 定位 | 是否入库 |
| --- | --- | --- |
| `units/` | 单元测试（`node:test`），可接 CI | ✅ 入库 |
| `smoke/` | 冒烟脚本：一次跑完能给出「有没有坏」的结论 | ✅ 入库 |
| `probe/` | 过程探针：测量/诊断用，需要手动传参、耗时较长 | ✅ 入库 |
| `tools/` | 工具脚本：种子数据、审计、统计等长期复用的辅助 | ✅ 入库 |
| `tmp/` | 一次性验证脚本与中间产物，**默认不入库** | ❌ 忽略 |

> 新脚本的归类判断：**能重复执行 + 结论可判定的** → `smoke/`；**输出是数据/报告、不判对错** → `probe/` 或 `tools/`；**只服务某一次排查** → `tmp/`。

## 1. 单元测试 `units/`

```bash
npm run test:units        # node --test "testjs/units/*.test.js"
```

零第三方依赖（`node:test` + `node:assert`），失败时进程退出码非 0，可直接接 CI。

| 文件 | 覆盖范围 |
| --- | --- |
| `backend.test.js` | 后端数据层与纯逻辑：建表最终形态（四个合并表、旧逻辑名退化为只读视图、播种行数、`domain_history` payload → 三域历史视图的 JSON 映射、二次 `initSchema` 幂等、`slotStore` 逻辑名/可写列映射）、`sanitize` 系列清洗/校验、恢复密钥归一化/哈希/常数时间比较、请假时间窗与 SQL 时间戳 |
| `frontend.test.js` | 前端纯函数：图表命中算法（分带/行/饼图扇区/图例）、AI 图表数据解析（类型白名单、项数上限、饼图 Top N + 其他）、热力配色、`collectPdfText` 边界（循环引用/超深递归/空输入）、表格关键字过滤与「无结果」判定 |
| `albumScan.test.js` | 相册扫描的「索引被误删/清空」防护 |
| `refresh-virtual.test.js` | 虚拟相册刷新（按索引更新、补 EXIF/缩略图、源文件缺失保留行、幂等） |

新增测试：在 `units/` 下建 `*.test.js`，用 `node:test` 的 `test()` 写即可，无需改配置。
需要 `student-backend` 依赖（如 `better-sqlite3`）时，用
`createRequire(path.join(ROOT, 'student-backend/package.json'))` 解析，见 `backend.test.js`。
前端是 ESM 的模块，用 `pathToFileURL` + 动态 `import()` 加载，见 `frontend.test.js`。

## 2. 冒烟测试 `smoke/` —— 统一入口

```bash
npm run smoke                        # 一次跑完 smoke/ 下所有脚本
node testjs/run-smoke.cjs --list     # 只看会跑哪些
node testjs/run-smoke.cjs --only=pdf # 只跑文件名含 pdf 的（可重复传）
node testjs/run-smoke.cjs --skip=pdf # 跳过文件名含 pdf 的（可重复传）
node testjs/run-smoke.cjs --bail     # 第一个失败就停
```

**每个脚本也可以单独跑**：`node testjs/smoke/<文件名>`。

约定：
- 退出码 `0` = 通过，非 0 = 失败；**退出码 `3` = 脚本自己判定「环境不具备，跳过」**（如缺 `fontTools`），不计失败。
- 需要后端在跑的脚本（`auth-smoke.js`）在后端未监听 3000 端口时判为跳过。
- `.py` 脚本找不到 python 时跳过。

| 脚本 | 覆盖范围 |
| --- | --- |
| `api-smoke.cjs` | 后端基础接口连通 |
| `auth-smoke.js` | 认证链路：注册 → 确认 → 登录 → 改密 → 改名，以及隐私模式下的口令包裹/恢复词校验（**需后端**，默认端口 3999，`PORT` 可覆盖） |
| `collator-equiv-probe.js` | `Intl.Collator` 与前端等价排序一致性 |
| `unzip-safe-test.cjs` | 自研安全解压：符号链接/路径穿越/绝对路径/反斜杠全部拦截 |
| `pptx-guard-test.cjs` | PPTX 导入的守卫生效 |
| `thumbs-cache-test.cjs` | 缩略图缓存目录与命中逻辑 |
| `theme-setting-probe.mjs` | 主题设置项读写 |
| `secure-channel-retry.js` | 安全信道 401 重试：会话过期 / 凭据降级 / 绑定失效时是否正确重发（**需 Vite 开发服务器**，页面在 `student-frontend/dev-probes/`，经 `tools/electron-page-probe.cjs` 跑） |
| `pdf-subset-verify.mjs` | PDF 字体动态子集产出核对 |
| `font-subset-verify.py` | 子集 cmap 是否覆盖实际绘制的全部字符（需 `fontTools`） |

## 3. 过程探针 `probe/`

需要手动传参、耗时较长或会拉起完整应用的诊断脚本。**不是回归测试**，别放进冒烟。

| 脚本 | 用途 |
| --- | --- |
| `measure-startup.mjs` | 启动耗时。`--backend-only` / `--dev` / `--json` / `--runs` / `--exe` 等参数见文件头注释 |
| `inp-probe.mjs` | 交互延迟（INP）。自动起 Vite 与带调试口的 Electron，用 CDP 派发真实输入事件 |
| `mode-probe.mjs` | 日/夜模式切换开销测量 |
| `ocr-probe.mjs` | OCR 可用性（Windows 有效） |
| `pdf-leak-probe.mjs` | PDF 导出内存泄漏核查（看 V8 external，不看 rss） |
| `widget-bottom-regression.ps1` | 桌面组件置底模式的回归检查：`-Drags N` 次合成拖动，逐项断言位移正确、尺寸不变、松手后仍压在 `Progman` 之上、无 `Application Error`（需应用在跑且置底模式已开） |
| `widget-shot.ps1` | 把组件窗口临时提到最前截图（`-Out` 指定路径），截完自动按「第一个可见窗口之下」压回去，用于核对圆角/透明/蓝色 |
| `toplevel-bottom-probe.cjs` | 「顶层置底」最小原型：顶层窗口 + 透明 CSS 圆角 + 真实鼠标拖动 + z 序自检，不含业务代码，可独立跑 |
| `inject-drag.ps1` | 用 `SetCursorPos` + `mouse_event` 合成一次真实左键拖动（虚拟化坐标），配合上面几个脚本做输入验证 |

`measure-startup.mjs` 的数据隔离在 `%LOCALAPPDATA%\BanjiiStartupMeasure`，不碰真实用户数据。

> **关于已删除的 `pipe-*` 评估脚本**：它们曾用于「命名管道 + ACL 通信层方案」的评估与实测。
> 该方案已因引入 5 层间接而收益仅约 1ms、且 axios fetch adapter 对 204 响应误判导致页面闪跳，
> **最终全量回退**。评估结论与实测数据保留在 `doc/开发文档/通信层方案评估-命名管道与ACL.md`，
> 脚本本身不再随仓库维护（需要复跑时见 `git stash` 中的 `pipe-migration-wip`）。

## 4. 工具 `tools/`

| 脚本 | 用途 |
| --- | --- |
| `seed-test-data.js` | 灌测试数据。`npm run seed`；`SEED_BASE` / `SEED_USER` / `SEED_PASSWORD` 可覆盖。**需后端在跑** |
| `comment-audit.js` | 注释保真审计：比对拆分前后的注释，只读不改。`AUDIT_BASE=<git ref>` 指定基准 |
| `album-sql-args.js` | 相册 SQL 参数构造的辅助核对 |
| `code_stats.ps1` | 代码量统计（PowerShell） |

`seed-test-data.js` 是幂等的：按业务键去重，重复运行不会堆重复数据。产出账号 `测试班主任` / `test1234`。

## 5. `tmp/`

只服务某一次排查的脚本与中间产物（如字体子集对比、缩略图基准、Excel 阻塞测量）。**默认不入库**，
确认不再复用就留在这里，需要时可整个目录删除。
