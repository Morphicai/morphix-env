#!/usr/bin/env node
/**
 * ESM 具名导出可见性冒烟（naming-cutover 4.1）：cjs-module-lexer 静态解析
 * tsup CJS 产物的具名导出——保证 `import { x } from '<pkg>'` 经 Node
 * CJS↔ESM 互操作可解析。仅查运行时符号；type-only 导出（12 个 facade 类型）
 * 是编译期符号、天然不在 CJS 运行时导出面，其面由 dist/*.d.ts 钉（root
 * test/index.test.ts）。若 tsup `__export` getter 形态不可解析则本脚本红。
 */
import { readFileSync, existsSync } from 'node:fs'
import { parse } from 'cjs-module-lexer'

const checks = [
  {
    file: 'dist/index.js',
    label: 'morphix-env facade 运行时面',
    names: ['composeEnvironment', 'CompositionError', 'loadConfigLayers', 'validateConfig', 'StreamingRedactor'],
  },
  {
    file: 'packages/mxenv-core/dist/contracts.js',
    label: '@morphixai/mxenv-core/contracts',
    names: [
      'CONFIG_FILE', 'CompositionError', 'GLOBAL_CONFIG_DIR', 'GLOBAL_CONFIG_FILE', 'GLOBAL_ENV_FILE',
      'StreamingRedactor', 'collectRedactionValues', 'findMxEnvReferences', 'hasMxEnvReference',
      'isPublicKey', 'normalizeProfile', 'referencePattern', 'validateConfig',
    ],
  },
  {
    file: 'packages/mxenv-core/dist/index.js',
    label: '@morphixai/mxenv-core 主入口（抽样）',
    // warnDeprecatedBinInvocation 已随垫片移除退役（0.13.x），不得回潮。
    names: ['composeEnvironment', 'loadConfigLayers', 'validateConfig', 'auditDir', 'resolveGlobalDir'],
  },
]

let failed = false
for (const { file, label, names } of checks) {
  if (!existsSync(file)) {
    console.error(`[named-exports] ${file} 缺失（先跑 pnpm -r build）`)
    failed = true
    continue
  }
  const { exports } = parse(readFileSync(file, 'utf8'))
  const missing = names.filter((n) => !exports.includes(n))
  if (missing.length) {
    console.error(`[named-exports] ${label}（${file}）静态不可见：${missing.join(', ')}`)
    failed = true
  } else {
    console.log(`[named-exports] ${label}（${file}）${names.length} 个具名导出静态可见 ✓`)
  }
}
process.exit(failed ? 1 : 0)
