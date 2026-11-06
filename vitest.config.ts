import { defineConfig } from 'vitest/config'

// workspace 根的测试发现范围与拆包前保持一致（仅 test/）；
// packages/* 的测试由各包自己的 vitest.config + test script 运行（vitest 项目化）。
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
