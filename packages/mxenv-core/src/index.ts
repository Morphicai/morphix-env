// L1 能力层入口 —— composition/providers/config/audit/refs/secrets/redaction/shims。
// 各能力模块的全部公开符号在此 re-export；L0 契约符号同时经 /contracts 与
// 本入口暴露（消费者面不倒退）。值能力窄暴露（compose/revealSingle 唯一实现）
// 收口见任务 2.3：compose = composeEnvironment（唯一实现在 composition）；
// revealSingle 暂无既有实现可迁（详见 package-split 2.3 处置记录）。
export * from './contracts'
export * from './audit'
export * from './composition'
export * from './config'
export * from './env'
export * from './infisical'
export * from './redaction'
export * from './refs'
export * from './shims'
export * from './sources'
