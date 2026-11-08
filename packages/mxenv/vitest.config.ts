import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    // workspace 依赖解析到 mxenv-core 源码：core 的 keytar 经 dynamic import
    // 取用，dist bundle 会逃过 vi.mock('keytar') 的模块拦截；走源码让 mock
    // 停留在 vite 模块图内（value-reveal 揭示路径与 sources 加载同 mock 面）。
    alias: {
      '@morphixai/mxenv-core/contracts': resolve(__dirname, '../mxenv-core/src/contracts.ts'),
      '@morphixai/mxenv-core': resolve(__dirname, '../mxenv-core/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
