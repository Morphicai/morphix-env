# Spec Delta

## REMOVED Requirements

### Requirement: 旧名垫片与弃用窗口

兼容垫片 SHALL 保留一个 minor 周期（0.12.x；0.13 起移除并在 CHANGELOG 公告）：旧命令名 `mx-env`/`morphix-env` 等价于 `mxenv` 并向 stderr 输出一行弃用提示，stdout SHALL 保持机器可读纯净（`export`/eval 场景不受污染）；配置读取按 `mxenv.config.json` 优先、缺失时读 `mx-env.config.json`；插件解析按 `mxenv-provider-<plugin>` 优先、缺失时回退 `mx-env-provider-<plugin>`。配置写操作 SHALL 落盘到 `mxenv.config.json`：若本次读取自 `mx-env.config.json` 且新名文件不存在，写入前 SHALL 将旧文件备份并改名至新名，维持单一配置事实源。

#### Scenario: 旧命令可用且提示弃用

- **WHEN** 执行 `mx-env run -- true`
- **THEN** 行为与 `mxenv run -- true` 一致，stderr 出现一行弃用提示

#### Scenario: 弃用提示不污染 stdout

- **WHEN** 旧命令执行 `export`
- **THEN** stdout 仅含 export 内容（可安全 eval），弃用提示仅在 stderr

#### Scenario: 双配置并存新名优先

- **WHEN** 项目同时存在 `mxenv.config.json` 与 `mx-env.config.json`
- **THEN** 读取 `mxenv.config.json`，忽略旧文件并提示清理

#### Scenario: 旧插件名仍被识别

- **WHEN** 配置声明 provider 插件且仅安装了 `mx-env-provider-<plugin>`
- **THEN** 插件被正常调用；`mxenv-provider-<plugin>` 存在时优先

**Reason**: 垫片窗按 0.12.0 的到期公告关闭——该 requirement 描述的是 0.12.x 窗口期行为（旧名等价转发、读回落、插件回退），窗期已满一个 minor 周期，行为面随 0.13.x 摘除，由下方 ADDED requirement 取代。
**Migration**: 升级到 0.13.x：改用 `mxenv` 命令名；旧配置文件改名为 `mxenv.config.json`（或跑 `mxenv migrate --home` 走既有迁移）；插件包改用 `mxenv-provider-<plugin>` 名；存量旧 shim 重跑 `mxenv-cli shell-init` 再生成。详见 CHANGELOG 0.13.1 公告。

## ADDED Requirements

### Requirement: 垫片移除与到期公告

兼容垫片窗 SHALL 按 0.12.0 的到期公告关闭（0.13.x 起移除并在 CHANGELOG 公告）：旧命令名 `mx-env`/`morphix-env` SHALL NOT 以 bin 名安装或以 alias 形式转发，`mxenv` 是唯一命令名；配置读取 SHALL 只认 `mxenv.config.json`，旧文件 `mx-env.config.json` SHALL NOT 参与解析（检测到其存在时 SHALL 给出改名指引，不静默无配置）；插件解析 SHALL 只认 `mxenv-provider-<plugin>`，SHALL NOT 回退 `mx-env-provider-<plugin>`。配置写操作 SHALL 落盘到 `mxenv.config.json`，维持单一配置事实源。旧生成 shim（委派 `mx-env run` 的历史生成物）SHALL NOT 由任何转发层兜住；升级公告 SHALL 引导重跑 `mxenv-cli shell-init` 再生成。

#### Scenario: 旧命令名不可用

- **WHEN** 执行 `mx-env run -- true`
- **THEN** 命令不存在（无任何 bin/alias 转发），`mxenv` 是唯一入口

#### Scenario: 旧配置文件不参与解析但给出指引

- **WHEN** 项目只有 `mx-env.config.json` 而无 `mxenv.config.json`
- **THEN** 配置解析不读旧文件，输出指向改名迁移的指引（非静默空配置）

#### Scenario: 双配置并存只认新名

- **WHEN** 项目同时存在 `mxenv.config.json` 与 `mx-env.config.json`
- **THEN** 读取 `mxenv.config.json`，旧文件不参与并提示清理

#### Scenario: 旧插件名不再被识别

- **WHEN** 配置声明 provider 插件且仅安装了 `mx-env-provider-<plugin>`
- **THEN** 插件解析失败并报告缺失的 `mxenv-provider-<plugin>`（不回退旧名）

#### Scenario: 旧 shim 失效与再生成

- **WHEN** 用户升级到垫片移除版本后执行 0.12.x 生成的、委派 `mx-env run` 的旧 shim
- **THEN** 执行失败；升级公告引导重跑 `mxenv-cli shell-init` 再生成委派 `mxenv` 的 shim
