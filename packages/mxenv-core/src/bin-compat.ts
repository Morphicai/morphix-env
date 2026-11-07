import { basename } from 'path'

/**
 * bin 弃用垫片（naming-migration「旧名垫片与弃用窗口」）：0.12.x 内旧命令名
 * `mx-env`/`morphix-env` 与 `mxenv` 等价；每次经旧名调用向 stderr 输出一行
 * 弃用提示。stdout 必须保持机器可读纯净（`export`/eval 场景），提示只进
 * stderr。0.13 移除垫片时本模块一并退役。
 */
const DEPRECATED_BIN_NAMES = new Set(['mx-env', 'morphix-env'])

/**
 * argv[1] 在 symlink bin 调用下保留调用名（node 不解析 symlink——已实证），
 * 故 basename 即用户敲下的命令名。经新名/直接 node dist/cli.js 调用时无提示。
 * 返回是否命中旧名（便于测试断言）。
 */
export function warnDeprecatedBinInvocation(argv1?: string): boolean {
  const name = basename(argv1 || '')
  if (!DEPRECATED_BIN_NAMES.has(name)) return false
  process.stderr.write(
    `[mxenv] 命令名 "${name}" 已弃用：请改用 \`mxenv\`（0.12.x 内行为等价，0.13 起移除）\n`,
  )
  return true
}
