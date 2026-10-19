# testjs

开发期辅助脚本集合。**都不参与打包**，也不被应用代码引用；除 `seed-test-data.js` 需要后端在运行外，
其余脚本在任意工作目录下执行都可以（内部自行解析仓库根目录）。

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

新增测试：在 `units/` 下建 `*.test.js`，用 `node:test` 的 `test()` 写即可，无需改配置。
注意：需要 `student-backend` 依赖（如 `better-sqlite3`）时，用
`createRequire(path.join(ROOT, 'student-backend/package.json'))` 解析，见 `schema.test.js`。

## 2. 测试数据 `seed-test-data.js`

```bash
npm run seed                 # 等价于 node testjs/seed-test-data.js
SEED_BASE=http://127.0.0.1:3000 node testjs/seed-test-data.js   # 指向别的后端
SEED_USER=演示账号 SEED_PASSWORD=demo1234 node testjs/seed-test-data.js   # 换个账号灌
```

- **前提**：后端已在运行（`npm run electron:dev` 或打包版），否则会连接失败。
- **可重复执行**：学生/班费/请假/加分/活动/倒计时/班干部按业务键去重；宿舍组每次重建；
  「学习小组」维度先删同名再建。重复运行不会堆重复数据。
- **产出**：账号 `测试班主任` / 密码 `test1234`，以及学生 30 名、座位、课表、值日、分组、班干部、
  班费、请假、加分、活动、倒计时、学期范围、权重、历史快照、首页班级信息。
- 注册走「带密码注册 → `/api/register/confirm` 确认」的完整流程；已存在则自动改为登录。
- 运行结束会回读 `/api/dashboard` 打印各域数量，便于确认。

## 3. 性能测量

### `measure-startup.mjs` —— 启动耗时

```bash
node testjs/measure-startup.mjs                 # 正式版整体启动，默认 3 次
node testjs/measure-startup.mjs --backend-only  # 只测后端冷启动
node testjs/measure-startup.mjs --dev           # 未打包 Electron + Vite
node testjs/measure-startup.mjs --json          # 机器可读
```

数据隔离在 `%LOCALAPPDATA%\BanjiiStartupMeasure`，不会碰真实用户数据。
完整参数见文件头部注释（`--runs` / `--exe` / `--cold` / `--duration` / `--grace` / `--real`）。

### `inp-probe.mjs` —— 交互延迟（INP）

```bash
node testjs/inp-probe.mjs
```

会先关掉单实例锁冲突、自动起 Vite 与带调试口的 Electron，用 CDP 派发真实输入事件，
输出「场景 → 输入延迟 / 处理 / 呈现」表。`INP_ONESHOT=1` 可在出报告后直接退出。

## 4. 其他探针

### `ocr-probe.mjs` —— OCR 可用性

```bash
node testjs/ocr-probe.mjs                 # 默认示例文字
node testjs/ocr-probe.mjs "班费支出 500 元"
OCR_TEXT="第一行|第二行" node testjs/ocr-probe.mjs
```

用 `sharp` 现场生成带中文的 PNG，再调系统 OCR 识别。仅 Windows 有效。

### `comment-audit.js` —— 注释保真审计

```bash
node testjs/comment-audit.js
AUDIT_BASE=<git ref> node testjs/comment-audit.js
```

把 `units` 清单里「拆分前文件（git 某版本）」与「拆分后目录」的注释逐条比对，
区分「改写/换行」与「真丢失」。只读，不改代码；新的拆分完成后往数组里追加一条即可复用。
