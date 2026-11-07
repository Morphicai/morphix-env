import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    contracts: 'src/contracts.ts',
  },
  format: ['cjs'],
  dts: true,
  clean: true,
  // keytar 是 optionalDependencies 且经动态 import() 解析，tsup 不会自动
  // externalize optionalDeps —— 必须显式声明，保持原生模块走运行时解析（N5）。
  external: ['keytar'],
})
