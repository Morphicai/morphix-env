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
