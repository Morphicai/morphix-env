#!/usr/bin/env node
/**
 * morphix-env 0.12.x 收尾转发 stub（naming-cutover 4.1）：
 * 旧 bin 名 `mx-env`/`morphix-env` 与 `morphix-env/cli` 入口转发到 `mxenv`
 * 包的 CLI——行为等价、退出码透传。0.13 摘垫片时本 stub 一并退役。
 */
'use strict'
const { spawnSync } = require('child_process')
const path = require('path')

// 迁移提示（对齐 bin-compat 口径，一次一行）：内层 CLI 经 node 直调时 argv[1]
// 是脚本路径、不触发其弃用提示，由本 stub 兜底输出；内层经旧名 symlink 调用
// 时 bin-compat 自己输出，两条路径互斥、不重复轰炸。
process.stderr.write(
  '[mxenv] "morphix-env" 0.12.x 起只是转发壳：请改用 `@morphixai/mxenv`（项目）或 `@morphixai/mxenv-cli`（全局管理面）。\n',
)

let cliPath
try {
  // @morphixai/mxenv 的 exports map 不放行 ./dist/*，经 package.json 解析定位后用直接路径执行。
  const manifestPath = require.resolve('@morphixai/mxenv/package.json')
  cliPath = path.join(path.dirname(manifestPath), 'dist', 'cli.js')
} catch {
  process.stderr.write(
    '[mxenv] 找不到 `@morphixai/mxenv` 包：请安装 `@morphixai/mxenv`（项目 devDep）或 `@morphixai/mxenv-cli`（全局管理面）后重试。\n',
  )
  process.exit(1)
}

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) {
  process.stderr.write(`[mxenv] 转发执行失败：${result.error.message}\n`)
  process.exit(1)
}
process.exit(result.status === null ? 1 : result.status)
