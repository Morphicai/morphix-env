# Spec Delta

## MODIFIED Requirements

### Requirement: 迁移发现与计划

`mxenv migrate`（不带 `--to`）SHALL 为纯只读操作：发现当前作用域内的可迁移单元（全局隐式 `~/.mxenv/.env` 若存在且为明文；全局与项目配置中声明的 `local` 源），并对每单元打印文件路径、key 名清单与计划动作。发现过程 SHALL NOT 打印任何密钥值、SHALL NOT 写任何文件。存在 legacy `.env.local`/`envFiles` 明文文件时 SHALL 提示"建议声明为 source 后再迁移"且不自动迁移。

#### Scenario: 只读 discovery

- **WHEN** 项目配置声明了 local 源且 `~/.mxenv/.env` 存在，执行 `mxenv migrate`
- **THEN** stdout 列出各单元的名称、文件路径、key 名与可用目标，文件系统零改动

#### Scenario: 值永不出现

- **WHEN** 任意 migrate 子路径执行（discovery、dry-run、执行、失败）
- **THEN** stdout/stderr 均不含任何密钥值（key 名允许）

#### Scenario: 无明文可迁移

- **WHEN** 作用域内无 local 明文单元
- **THEN** 输出"无可迁移单元"类信息，退出码 0

### Requirement: dotenvx 目标迁移

`mxenv migrate --to dotenvx` SHALL 对每个选定单元：备份明文文件（0600）→ 以 dotenvx CLI 原地加密（`--no-native` 固定文件模型，保证 `.env.keys` 落于文件同目录而非进入 OS keychain；`.env.keys` 置 0600）→ 经 `decrypt --stdout --no-native` 重载并与迁移前快照做键集与值的精确等价验证 → 对声明源改写其配置文件（`provider: 'local'` → `'dotenvx'`，files 列表只保留迁移时存在的文件，改写前备份该配置文件）。验证失败 SHALL 中止该单元：从备份还原明文与配置，stderr 给出备份路径与回滚指引。dotenvx CLI 缺失时 SHALL 硬失败并给出安装指引。

两个单元共享同一明文文件时 SHALL 硬失败并列出冲突（不可独立迁移），不执行任何写入。

#### Scenario: 声明源迁移成功

- **WHEN** 项目配置声明 `{provider:'local', files:['.env.local']}` 含 key A/B，执行 `mxenv migrate --to dotenvx`
- **THEN** `.env.local` 成为加密文件（原文不可读出新值）、同目录出现 0600 的 `.env.keys`、配置中该源 provider 变为 `dotenvx`、迁移前后 `mxenv run` 组合出的 A/B 值一致

#### Scenario: 幂等重跑

- **WHEN** 对已完成 dotenvx 迁移的单元再次执行 `mxenv migrate --to dotenvx`
- **THEN** discovery 不再列出该单元（无明文），无写入

#### Scenario: 验证失败回滚

- **WHEN** 加密后重载值与快照不等价
- **THEN** 该单元明文文件与配置从备份还原，退出码非零，stderr 指明备份路径

#### Scenario: 跨单元共享文件被拒

- **WHEN** 两个声明源的 files 指向同一文件，执行 `mxenv migrate --to keychain`
- **THEN** 命令硬失败并列出冲突文件与两个单元名，无写入

#### Scenario: git 仓库内的 `.env.keys` 警告

- **WHEN** 迁移产物 `.env.keys` 位于 git 仓库内且未被 ignore
- **THEN** stderr 给出强警告（该文件绝不可提交），不阻断迁移

### Requirement: keychain 目标迁移

`mxenv migrate --to keychain` SHALL 仅作用于声明源（全局隐式文件不支持该目标，遇之则提示改用 dotenvx）：备份 → 逐 key `setPassword` 到 service（默认 `mxenv:<source名>`）→ keychain 读回验证（**键集子集比对**：迁移的每个 key 值与快照相等即通过；service 中的无关账户 SHALL 仅产生警告不阻断——默认 service 名跨项目可能撞车）→ 改写配置为 `{provider:'os-keychain', service}`（保留 `override`、丢弃 `optional`）→ 删除明文文件。覆盖同名既有账户时，失败回滚 SHALL 写回旧值而非仅删除（不静默丢失用户数据）。仅 macOS；keytar 不可用 SHALL 硬失败。`--service` 仅在与 `--source` 单选同用时合法。零 key 的单元 SHALL 报告 skipped 而非伪造迁移成功。

#### Scenario: keychain 迁移成功

- **WHEN** macOS 上项目声明 local 源（名 `mysource`）含 key A/B，执行 `mxenv migrate --to keychain --source mysource`
- **THEN** keychain service `mxenv:mysource` 含 A/B、配置改写为 os-keychain 源、明文文件已删除、组合值与迁移前一致

#### Scenario: 全局隐式文件拒绝 keychain 目标

- **WHEN** discovery 含全局隐式单元且执行 `--to keychain`
- **THEN** 该单元被跳过并提示改用 dotenvx，其余声明源正常迁移

#### Scenario: 目标 service 已含无关账户

- **WHEN** 目标 keychain service 中已有与迁移无关的账户
- **THEN** 迁移成功（子集验证通过）且警告指出 service 含无关账户

#### Scenario: 同名账户被覆盖后失败回滚

- **WHEN** 目标 service 已有同名账户，setPassword 覆盖后迁移因故失败
- **THEN** 回滚将旧值写回该账户（不是删除、不是保留新值）

#### Scenario: 旧 service 名继续有效

- **WHEN** 配置中已记录 `mx-env:mysource` 的 os-keychain 源（命名切换前的迁移产物）
- **THEN** 读取按配置记录的 service 名照常工作，不要求重迁移

### Requirement: 全局隐式文件的加密感知加载

组合层构造全局隐式源时 SHALL 嗅探 `~/.mxenv/.env` 内容（全局目录解析与 legacy `~/.mx-env/` 兼容读取见 home-migration）：同时含 `DOTENV_PUBLIC_KEY` 头与至少一个 `encrypted:` 值则以 dotenvx provider 构造该源（无需任何配置变更），否则维持 local 行为。该隐式 dotenvx 路径 SHALL 对 `<全局目录>/.env.keys` 套用与明文时代相同的权限门禁（文件存在则须 0600，除非 `--allow-insecure-global` 或 win32；文件不存在不报错——`DOTENV_PRIVATE_KEY` env 注入是合法模型）。项目内显式声明的 dotenvx 源 SHALL NOT 套用该门禁。dotenvx provider 的组合语义 SHALL 为"文件值优先"（`--overload`），与 local 源一致。

#### Scenario: 加密后组合行为不变

- **WHEN** `~/.mxenv/.env` 已经 `mxenv migrate --to dotenvx` 加密，执行任意组合命令
- **THEN** 组合结果与加密前逐 key 一致，配置文件未被要求改动

#### Scenario: 权限过宽的 `.env.keys` 被拒

- **WHEN** 全局隐式文件已加密而 `~/.mxenv/.env.keys` 权限非 0600
- **THEN** 组合失败并给出 chmod 0600 或 `--allow-insecure-global` 的指引（win32 除外）

### Requirement: local 明文的 dev-only 标记与可选提醒

`mxenv inspect` SHALL 对 provider 为 `local` 的源在输出中追加 `[plaintext, dev-only]` 标识（含全局隐式与 legacy 源）。组合路径（run/export/render/generate）在 `--warn-plaintext` flag 或 `MXENV_WARN_PLAINTEXT=1` 时 SHALL 对实际 loaded 且贡献 key 的 local 源输出一次 stderr 提醒并指向 `mxenv migrate`；默认不提醒。README 与 SKILL.md SHALL 声明 local 明文仅开发用，并指引 agent 场景使用 `run --serve`。

#### Scenario: inspect 标识

- **WHEN** 组合中含 local 明文源，执行 `mxenv inspect`
- **THEN** 该源行含 `[plaintext, dev-only]`，dotenvx/keychain 源不含

#### Scenario: 提醒可选且默认关闭

- **WHEN** 未传 flag 未设 env 时执行 `mxenv run -- true`
- **THEN** 无明文提醒；传 `--warn-plaintext` 或设 `MXENV_WARN_PLAINTEXT=1` 时 stderr 出现一次提醒（值-free）
