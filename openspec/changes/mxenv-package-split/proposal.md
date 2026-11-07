# Proposal

## Why

分层纪律（上层只依赖下层、通用能力下沉共享）要落成机器可验证的边界，必须先把单包 `morphix-env` 0.11.0 的混装结构拆开：组合引擎、providers、audit、editor、CLI 全在一个包里，无法表达 L0–L3 边界，也无法消解"项目钉版本 vs 全局滚动"的版本错位——Trellis W2 等 SDK 消费方即将成为值能力的第二个调用方，值能力必须先下沉为唯一实现。本 change 是 Wave A（`docs/ux-architecture.md`）的结构基座；命名面归 `mxenv-naming-cutover`，全局目录迁移归 `mxenv-home-migration`，两者依赖本 change 的三包结构。

## What Changes

- **BREAKING 仓形态**：转 pnpm workspace，`packages/` 下三包 `@morphixai/mxenv-core`（L0 契约 `/contracts` 纯无 IO 入口 + L1 能力主入口）、`@morphixai/mxenv`（L2 运行面）、`@morphixai/mxenv-cli`（L3 管理面，Wave A 仅 shell-init）；0.12.0 起三包 lockstep。（2026-11-07 定夺：npm 名相似度政策拒 unscoped `mxenv`，包名走 `@morphixai/*` scope，目录段/命令名不变。）
- **值能力收口**：`compose`/`revealSingle` 唯一实现移入 `mxenv-core` 主入口；`/contracts` 入口纯无 IO；L2/L3 不得出现第二套解密实现。
- **项目态写操作版本对齐**：全局 CLI 项目态写操作 spawn 项目本地 CLI（解析顺序 cwd → `node_modules/.bin` → PATH），无法解析硬失败给安装指引。
- **命令面归属**：`run`/`export`/`inspect`/`render`/`generate`/`edit`/`migrate`/`skill install` → L2 `mxenv`；`shell-init` → L3 `mxenv-cli`；统一命令入口的可选模块发现推迟 Wave B（design D6）。

## Capabilities

### New Capabilities

- `package-boundary`: 三包分层契约——L0–L3 依赖只向下、`mxenv-core` 双入口（`/contracts` 纯无 IO + 主入口能力面）、值能力唯一实现与窄暴露、产品包零依赖与 spawn 版本对齐、项目装即完整可用（定制上游 / 全局变量 ∪ 项目 `env.local`）、全局增强只做加法。

## Impact

- 代码：`src/` 拆入三包（先绿再挪文件，每步可运行）；editor-ui + clientAssets 生成链随 `mxenv` 包；测试按包归位。
- 不改：组合语义、值纪律、migrate 行为、命令行为本身。
- 命名面：包名 `mxenv`/`mxenv-core`/`mxenv-cli` 随拆包固有确定；bin alias、配置/目录/插件名切换与垫片归 `mxenv-naming-cutover`，`migrate --home` 归 `mxenv-home-migration`。
