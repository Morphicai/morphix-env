# Proposal

## Why

`mx-env run -- <cmd>` 要求每次显式包裹命令。对高频终端操作（`pnpm dev`、`node script.js`、`python manage.py`）这是持续的摩擦，使用者（人（和 agent）会退回直接运行、绕过注入，密钥组合层形同虚设。目标是让**被声明的命令**在终端里裸敲即自动注入组合环境——方便性无感，同时保持"值只进被包裹命令的子进程"这一最小暴露面。

边界声明：shim 提供方便性而非对 agent 的隐藏（值在子进程 env，同 uid 可读）；需要隐藏的场景继续使用 `run --serve`（0.8.0 已发布）。网络层 MITM proxy 与 keychain 原生 API 不在本 change 范围（#4 远期/P3）。

## What Changes

- 新增 `shims` 配置字段：全局 `~/.mx-env/config.json` 与项目 `mx-env.config.json` 均可声明命令清单（如 `["node", "pnpm"]`），两级取并集；未声明的命令完全不受影响。
- 新增 `mx-env shell-init` 命令：为清单中每个命令在 `~/.mx-env/shims/` 生成 shim 可执行文件（内容为 `exec mx-env run -- "$@"` 等价物），输出需加入 shell rc 的 PATH 前置行；`--write` 幂等写入 rc，`--remove` 幂等移除。重复执行安全。
- `run` 命令新增递归防护：spawn 子进程前从子进程 PATH 剥离 `~/.mx-env/shims` 目录——注入只发生在顶层 shim 一次，子进程继承已组合环境，杜绝 shim → run → shim 无限循环。
- 审计：shim 触发的 `run` 经由既有 value-free audit 通道记录，并携带 `via_shim` 维度标记。
- 文档：README 新增 shell-init 章节与边界声明；SKILL.md 补充 shim 消费指引。

## Capabilities

### New Capabilities

- `terminal-command-shims`: PATH shim 的声明、生成、生命周期管理（init/remove）、递归防护与审计标记；全局与项目两级命令清单的合成规则。

### Modified Capabilities

- None.（`run` 的 PATH 剥离是新增防护行为，不改变既有非 shim 场景的对外契约；组合/编辑/context-hygiene 能力无 spec 级变更。）

## Impact

- 代码：`src/cli.ts`（新命令 + run 的 PATH 剥离）、新 `src/shims.ts`（清单解析/生成/幂等写入与移除）、`src/config.ts`（`shims` 字段校验）、`src/audit.ts`（via 维度）。
- 测试：新增 `test/shims.test.ts`（清单合成、shim 生成幂等、递归防护实证、卸载幂等）。
- 文档：README.md、skill/SKILL.md。
- 兼容性：纯新增；无既有行为变更，无依赖新增。不支持 fish（首版 bash/zsh；fish 用户继续显式 `run`）。
