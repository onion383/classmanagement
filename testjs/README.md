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
| `schema.test.js` | 建表最终形态：四个合并表、旧逻辑名退化为只读视图、播种行数、`domain_history` payload → 三域历史视图的 JSON 映射、二次 `initSchema` 幂等、`slotStore` 逻辑名/可写列映射 |
| `sanitize.test.js` | `cleanText` / `normBool` / `normNumber` / `strictDate` / `cleanPath` / `sanitizeField`（含课表、座位、值日等逻辑表名规则）/ `normalizeSeats` |
| `recoveryKey.test.js` | 恢复密钥的归一化、格式化、哈希稳定性与常数时间比较 |
| `heatColor.test.js` | 前端热力配色端点、钳制与前景色选择 |
| `backendLogic.test.js` | 请假时间窗校验、SQL 时间戳格式（会注入临时 `DATA_DIR` 与测试主密钥） |
| `pdfText.test.js` | 前端 `collectPdfText` 的循环引用、超深递归、null/函数输入等边界 |

新增测试：在 `units/` 下建 `*.test.js`，用 `node:test` 的 `test()` 写即可，无需改配置。
需要 `student-backend` 依赖（如 `better-sqlite3`）时，用
`createRequire(path.join(ROOT, 'student-backend/package.json'))` 解析，见 `schema.test.js`。
前端是 ESM 的模块，用 `pathToFileURL` + 动态 `import()` 加载，见 `heatColor.test.js`。

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
- 需要后端在跑的脚本（`auth-e2e-probe.js`、`auth-privacy-probe.js`）在后端未监听 3000 端口时判为跳过。
- `.py` 脚本找不到 python 时跳过。

| 脚本 | 覆盖范围 |
| --- | --- |
| `api-smoke.cjs` | 后端基础接口连通 |
| `auth-e2e-probe.js` | 注册 → 确认 → 登录 → 隐私模式全链路（**需后端**） |
| `auth-privacy-probe.js` | 隐私模式下的接口鉴权（**需后端**） |
| `collator-equiv-probe.js` | `Intl.Collator` 与前端等价排序一致性 |
| `unzip-safe-test.cjs` | 自研安全解压：符号链接/路径穿越/绝对路径/反斜杠全部拦截 |
| `pptx-guard-test.cjs` | PPTX 导入的守卫生效 |
| `thumbs-cache-test.cjs` | 缩略图缓存目录与命中逻辑 |
| `theme-setting-probe.mjs` | 主题设置项读写 |
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

`measure-startup.mjs` 的数据隔离在 `%LOCALAPPDATA%\BanjiiStartupMeasure`，不碰真实用户数据。

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
