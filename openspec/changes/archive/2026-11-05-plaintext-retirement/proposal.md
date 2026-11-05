# Proposal

## Why

2026-11-04 评审事故实证了 local 明文存储的弱点：同 uid 的 agent 一次 `mx-env export` 即把 `~/.mx-env/.env` 全量明文读入转录——0600 文件权限对 agent 场景不成立。dotenvx（加密文件）与 os-keychain provider 已具备存储端能力，缺的是**默认路径治理**：把现存明文一键迁入加密存储，并把 local 明文的定位钉死为"仅开发用"。本 change 落地 issue #7 的三项需求。

边界声明：keychain 原生 API + Touch ID（#4 P3）与网络层 proxy（#4 远期）不在范围；`run --serve` 消费端能力已随 0.8.0 发布，本 change 只做文档指引，不改其行为。

## What Changes

- **`mx-env migrate`**：local 明文 → dotenvx / os-keychain 的一键迁移。默认（无 `--to`）为 discovery + plan 纯只读；`--to dotenvx|keychain` 执行。每个迁移单元：0600 备份 → 写入目标存储 → 按需改写声明它的配置文件（自身也备份）→ 重组合做值级等价验证 → 通过后清理明文。`--dry-run` 输出完整执行计划不写入。
- **迁移范围**：全局隐式 `~/.mx-env/.env`（仅 dotenvx 目标，原地加密）+ 全局/项目配置中声明的 `local` sources（dotenvx 或 keychain）。legacy `.env.local`/`envFiles` 不自动迁移，discovery 中提示。
- **全局隐式文件加密感知**：组合层对 `~/.mx-env/.env` 嗅探 dotenvx 加密标记，加密后以 dotenvx provider 加载（配置零改动）；对应 `.env.keys` 套用与全局 `.env` 相同的 0600 门禁。
- **dev-only 标记**：`inspect` 对 local 明文源输出 `[plaintext, dev-only]` 标识；`--warn-plaintext` flag / `MXENV_WARN_PLAINTEXT=1` 开启组合路径 stderr 提醒（默认关闭）；README/SKILL.md 钉死 local 明文 = 仅开发用。
- **agent 消费指引**：README/SKILL.md 增补指引——agent 场景推荐 `run --serve`（值不进 env），说明 keychain 原生 API（#4 P3）落地后形成"agent 碰不到明文"完整链路。
- 迁移执行写 value-free 审计事件（key 名、目标 provider、结果；永不含值）。

## Capabilities

### New Capabilities

- `plaintext-retirement`: local 明文源的发现、迁移（dotenvx/keychain 两目标）、备份与值级等价验证、迁移后明文清理；全局隐式文件的加密感知加载；dev-only 标记与可选提醒。

### Modified Capabilities

- None.（全局隐式源的加密感知是加载路径的新增分支，既有明文行为不变；inspect 输出新增标识字段为附加信息，不改变既有字段。）

## Impact

- 代码：新 `src/migrate.ts`（discovery/plan/execute/verify）；`src/composition.ts`（全局隐式文件 dotenvx 嗅探）；`src/sources.ts`（dotenvx 源对 `.env.keys` 的 0600 门禁，限 globalImplicit）；`src/cli.ts`（`migrate` 命令、inspect 标识、warn-plaintext）；`src/audit.ts`（迁移事件类型）。
- 测试：新 `test/migrate.test.ts`（dotenvx/keychain 两目标的 dry-run/执行/等价验证/备份/幂等/回滚指引，临时 HOME）；既有组合与 inspect 测试补标记断言。
- 文档：README.md（migrate 章节 + dev-only 定位 + agent 指引）、skill/SKILL.md（消费指引）、CHANGELOG（0.10.0 草稿）。
- 兼容性：纯新增命令；既有命令行为不变（inspect 输出行尾追加标识）。dotenvx 目标要求 dotenvx CLI（与既有 dotenvx provider 同前置）；keychain 目标仅 macOS。
