# Design

## Context

单包 `morphix-env` 0.11.0：`src/` 内组合引擎、providers、audit、migrate、editor（editor-ui 经 tsup 打进 dist 的 `generated/clientAssets.ts`）、CLI 全部混装。方向稿 `docs/ux-architecture.md` 已定 L0–L3 分层与三波路线；行为契约见 `specs/package-boundary/`。兄弟 change：`mxenv-naming-cutover`（命名全切与垫片）、`mxenv-home-migration`（`migrate --home`）。

约束：维护力有限（一人仓）、版本错位现实存在（项目钉版本 vs 全局滚动）、值短命安全哲学不可破。命名面切换不在本 change——只做结构拆分；包名 `mxenv*` 是拆包固有命名，bin alias/配置/目录/scheme/插件名的切换归命名 change。

## Goals / Non-Goals

**Goals:**

- 三包拆分后分层边界可被机器验证（依赖清单/exports 检查进测试），不只是文档纪律。
- 拆包过程每步可运行（先绿再挪文件），全部既有测试随迁保持绿。

**Non-Goals:**

- 命名全切/垫片/bin alias/配置目录改名/`migrate --home`（兄弟 change）。
- daemon、常驻面板、`gui`/`global`/`host`（Wave B，另立 change）；icon/README 重排/gitleaks 历史扫描（Wave C）。
- 三包之外的任何新包（GUI 不独立发包）；repo 改名（推迟到 Wave C）。
- 契约语义演进（组合优先级、审计字段、值纪律只随文件平移，不改行为）。

## Decisions

### D1 仓形态：同仓 pnpm workspace 三包（monorepo）

`packages/` 下 `mxenv-core`、`mxenv`、`mxenv-cli` 三个子包，同仓 lockstep 版本、一个 PR 原子改三包、CI 一次跑全。

- 备选：三仓独立发布（协调成本高、原子变更难，放弃）；单包多模块（方案 B，见 `openspec/drafts/organization-alternatives.md`，留作退路）。
- 0.12.0 起三包版本号 lockstep 同步；`morphix-env`（旧包）只发收尾版 + `npm deprecate` 指路（发布归 `mxenv-naming-cutover`）。
- 过渡期根 package.json 保留 `morphix-env` 身份跑既有 build/test（先绿再挪文件），三包骨架并入 workspace 后逐步承接源码。

### D2 源码归属与双入口

| 目标包 | 迁入内容 |
|---|---|
| `mxenv-core` | `composition.ts`、`providers/*`、`config.ts`、`audit.ts`、`refs.ts`、`secrets.ts`、redaction、类型与 schema。exports map 双入口：`.`（L1 能力）+ `./contracts`（L0 纯契约，re-export schema/refs 语法/类型/redaction，无 IO） |
| `mxenv` | `cli.ts` 命令面（run/export/inspect/render/generate/edit/migrate/skill）、editor-ui + clientAssets 生成链 |
| `mxenv-cli` | `shell-init`（shim 生成）+ Wave B 预留（gui/global/host 骨架不实现） |

- 值能力（`compose`/`revealSingle`）只在 `mxenv-core` 主入口导出；`/contracts` 入口禁止 re-export 值能力（测试断言 exports 面）。
- editor-ui 的 `generated/clientAssets.ts` 生成物坑照旧：改 UI 必须重生成再 build。

### D5 spawn 版本对齐

全局 CLI 项目态写操作 spawn 项目本地 CLI，解析顺序 cwd → `node_modules/.bin` → PATH（复用 `ensureCommand` 既有哲学），无法解析即硬失败给安装指引；不静默以全局引擎改写项目数据。审计 `via` 记录 `cli`/`editor`/`host` 通道，Wave B 再补 `configPath`（本 change 不动审计字段）。

### D6 Wave A 命令面归属

`run`/`export`/`inspect`/`render`/`generate`/`edit`/`migrate`/`skill install` → L2 `mxenv`（项目级完整可用）；`shell-init` → L3 `mxenv-cli`（机器级能力，shim 清单位置随目录改名挪到 `~/.mxenv/`，改名归 `mxenv-naming-cutover`）。统一命令入口的"可选模块发现"机制（bin 单一来源）**推迟到 Wave B** 随 `gui`/`global` 一起定（待定项，不影响本 change 验收——Wave A 两包各有 bin，`mxenv-cli` 暂以 `mxenv-cli` 为 bin 名）。

## Risks / Trade-offs

- [lockstep 三包协调税] → 同仓原子 PR + 版本号同步脚本进 release checklist；若 0.x 期间实际很痛，退路是收回单包（方案 B，边界用 lint 守）。
- [editor-ui 生成物坑]（CSS/clientAssets 忘重生成导致修复静默不进包）→ tasks 里 build 校验含 `generated/clientAssets.ts` 一致性检查。
- [workspace 化冲击现有 build/test 链] → tsup 多入口 + vitest 项目化配置，先绿再挪文件（每步可运行）。

## Migration Plan

1. **开发**：workspace 骨架 → 挪 `mxenv-core` → 挪 `mxenv` → 起 `mxenv-cli`，每步全测试绿。
2. **验证**：单测/类型/构建绿 + `openspec validate --strict mxenv-package-split` + 分层边界断言（产品包依赖清单零互依、`/contracts` 无 IO、无第二套解密）+ clientAssets 生成物一致性。

## Open Questions

- 全局 CLI 包名 `mxenv-cli` 是否定案（现暂名；`mxenv-naming-cutover` 发布任务前最终确认）。
