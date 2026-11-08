# Proposal

## Why

命名四散（`mx-env`/`morphix-env`/`mx-env.config.json`/`~/.mx-env/`/`mx-env-provider-*`/`mx-env://`）是产品化五诉求之一（统一为 `mxenv`），且 **`mxenv://` 引用语法必须抢在 Trellis W2（`mx-env-secret-source`，尚未写码）实施前定案**，否则旧名会固化进另一个仓的实现。借 0.12.0 BREAKING 窗口一次完成命名全切，旧名垫片保证存量用户无感一个 minor 周期；开源门面（LICENSE/SECURITY.md，密钥工具硬伤）已随文档先行补齐（2026-11-06）。结构前提见 `mxenv-package-split`；全局目录搬迁见 `mxenv-home-migration`。

## What Changes

- **BREAKING 命名全切**：bin `mx-env`/`morphix-env` → `mxenv`（旧名 alias 一个 minor 周期，stderr 弃用提示一次）；URI scheme `mx-env://` → `mxenv://`（零存量消费者已实证，无垫片直切，遇旧 scheme 报错提示改用新 scheme）；配置 `mx-env.config.json` → `mxenv.config.json`（读双认、写只落新名）；插件 `mx-env-provider-<plugin>` → `mxenv-provider-<plugin>`（解析双认）；keychain 默认 service `mxenv:<source名>`（旧 service 名配置携带照读，不要求重迁移）；shim 清单位置随全局目录新名 `~/.mxenv/`。
- **垫片与弃用窗口**：旧 bin 等价执行 + stderr 一行提示，stdout 保持机器可读纯净（`export`/eval 场景不受污染）；0.13 起移除垫片并在 CHANGELOG 公告。
- **开源基础件**：LICENSE（MIT 全文）/SECURITY.md 已建（任务 2.1 完成项）；`morphix-env` 发最后一版收尾转发 + `npm deprecate` 指路。
- **跨仓同步**：Trellis W2 change `mx-env-secret-source` 文案改 `mxenv://`，SDK 消费改依赖 `mxenv-core`（引用语法导出已随 `mxenv-package-split` 沉入 `mxenv-core/contracts`，W2 只做消费方）。

## Capabilities

### New Capabilities

- `naming-migration`: 命名全切与垫片契约——新名唯一生效面、旧名垫片（bin alias / 配置双读 / 插件双认）的行为与期限（`~/.mx-env` 全局目录一次性迁移与兼容读取另见 `mxenv-home-migration` 的 `home-migration`）。

### Modified Capabilities

- `plaintext-retirement`: requirement 正文的命令名/配置路径/全局目录引用随命名全切更新（`mx-env migrate` → `mxenv migrate`、`~/.mx-env/` → `~/.mxenv/` 等）；行为语义不变。
- `visual-editor`: requirement 正文的 CLI 入口与配置路径引用更新（`mx-env edit` → `mxenv edit` 等）；行为语义不变。

## Impact

- 代码：`src/refs.ts` 解析/生成只认 `mxenv://`；`src/config.ts` 路径常量改名并加旧名兼容读；bin alias、keychain 默认 service、插件解析、shim 清单位置随改。
- 发布：npm 三包 0.12.0（`@morphixai/mxenv-core`/`@morphixai/mxenv`/`@morphixai/mxenv-cli`，2026-11-07 scope 定夺——unscoped `mxenv` 被 npm 名相似度政策拒绝；结构归 `mxenv-package-split`）→ `morphix-env@0.12.0` 收尾转发 → `npm deprecate morphix-env`；GitHub Release 列迁移表。
- 本机与外部：zshrc 的 export eval 行、Trellis 侧 change 文案同步改名；skill 内容改名、安装目标不变。
- 不改：值安全纪律、组合语义、migrate 的 dotenvx/keychain 行为本身；`migrate --home` 工具归 `mxenv-home-migration`。
