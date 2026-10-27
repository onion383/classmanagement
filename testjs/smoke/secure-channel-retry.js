#!/usr/bin/env node
// =========================================================================
// secure-channel-retry.js —— 安全信道「401 重试」行为的回归测试
//
// 背景：桌面组件曾长期卡在「正在加载常用软件…」，根因之一是安全信道在会话过期 /
// 凭据降级时没有正确重试，而 401 又被当成「登录过期」把用户踢回登录页。这里用
// 一个浏览器上下文的断言页（student-frontend/dev-probes/secure-channel-retry.html）
// 驱动 secureAxios 的错误处理分支，逐条验证：
//   · GET 撞上 session-expired 会重建会话并重发（旧实现不会 → 全站持续 401）
//   · 带 body 的请求撞上 session-expired 也会重发
//   · 凭据降级（握手失败退回明文 Bearer）造成的 401 会重试且强制带 token
//   · auth-required 分支仍按原逻辑重试，且不被降级分支吞掉
//
// 退出码：0 = 通过；1 = 失败；3 = 环境不具备（Vite 开发服务器未启动）→ 跳过
// 前置：Vite 开发服务器在 5173 端口（npm run dev）
// =========================================================================
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const PAGE_URL = 'http://127.0.0.1:5173/dev-probes/secure-channel-retry.html'
const VITE_PORT = 5173
const TOOL = path.join(ROOT, 'testjs', 'tools', 'electron-page-probe.cjs')

function portAlive(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = (ok) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(700, () => done(false))
    sock.on('connect', () => done(true))
    sock.on('error', () => done(false))
  })
}

function runElectron() {
  return new Promise((resolve) => {
    let electronPath
    try {
      electronPath = require('electron')
    } catch (e) {
      resolve({ code: 3, out: '找不到 electron 可执行文件：' + (e && e.message) })
      return
    }
    const child = spawn(electronPath, [TOOL, PAGE_URL], {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (e) => resolve({ code: 1, out: out + '\n启动失败：' + e.message }))
    child.on('exit', (code) => resolve({ code: code ?? 1, out }))
  })
}

async function main() {
  if (!fs_exists(TOOL)) {
    console.log('FAIL 缺少探针工具：' + TOOL)
    process.exit(1)
  }
  if (!(await portAlive(VITE_PORT))) {
    console.log('SKIP Vite 开发服务器未在 5173 端口（npm run dev 后再跑）')
    process.exit(3)
  }

  const { code, out } = await runElectron()
  const lines = out.split(/\r?\n/)
  const results = lines.filter((l) => /^(PASS|FAIL)\s/.test(l))
  if (!results.length) {
    console.log(out)
    console.log('FAIL 没有拿到断言结果（探针页没跑起来？）')
    process.exit(1)
  }
  for (const l of results) console.log(l)
  const failed = results.filter((l) => l.startsWith('FAIL'))
  if (failed.length || code !== 0) {
    console.log('FAIL ' + failed.length + '/' + results.length + ' 条断言未通过（探针退出码 ' + code + '）')
    process.exit(1)
  }
  console.log('PASS 全部 ' + results.length + ' 条断言通过')
  process.exit(0)
}

function fs_exists(p) {
  try { require('node:fs').accessSync(p); return true } catch (_) { return false }
}

main()
