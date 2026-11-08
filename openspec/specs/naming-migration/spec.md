# naming-migration Specification

## Purpose
为 `mxenv` 命名全切提供安全迁移契约：新名唯一生效、旧名垫片限时兼容；`~/.mx-env` 全局目录一次性迁移与兼容读取另见 home-migration。

## Requirements

### Requirement: 新命名唯一生效面

系统 SHALL 以 `mxenv` 族为唯一命名面：命令 `mxenv`、npm 包 `@morphixai/mxenv`/`@morphixai/mxenv-core`/`@morphixai/mxenv-cli`（2026-11-07 scope 定夺，unscoped 名被 npm 相似度政策拒绝）、URI scheme `mxenv://`、项目配置 `mxenv.config.json`、全局目录 `~/.mxenv/`、插件 `mxenv-provider-<plugin>`、keychain 默认 service `mxenv:<source名>`。一切**写出**（配置落盘、新引用生成、迁移产物、帮助与文档输出）SHALL 只使用新名。`mx-env://` 引用 SHALL 被拒绝并提示改用 `mxenv://`（无存量消费者，不设 scheme 垫片）。

#### Scenario: 引用语法直切

- **WHEN** 解析含 `mx-env://` 的配置或引用
- **THEN** 拒绝并提示改用 `mxenv://`，不静默兼容

#### Scenario: 写出只用新名

- **WHEN** 任意工具改写配置文件（如 migrate 改写来源声明）
- **THEN** 配置文件名为 `mxenv.config.json`，新生成的引用为 `mxenv://`，产物中无旧名

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
