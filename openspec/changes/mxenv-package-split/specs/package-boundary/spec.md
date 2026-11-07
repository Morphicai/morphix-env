# Spec Delta

## Purpose

钉死三包分层边界（L0–L3）的对外契约：依赖只向下、`@morphixai/mxenv-core` 双入口、值能力唯一实现与窄暴露、产品包零依赖且版本经 spawn 对齐、项目装即完整可用。

## ADDED Requirements

### Requirement: 分层包与依赖方向

系统 SHALL 由三个发布包构成：`@morphixai/mxenv-core`（L0 契约 + L1 能力，包内双入口——`@morphixai/mxenv-core/contracts` 纯契约、主入口能力）、`@morphixai/mxenv`（L2 运行面）、全局 CLI `@morphixai/mxenv-cli`（L3 管理面）。（npm 名相似度政策拒 unscoped `mxenv`，2026-11-07 定夺走 `@morphixai/*` scope；目录段 `packages/mxenv*` 与 bin/命令名不受影响。）依赖 SHALL 只向下：L2 → L1/L0、L3 → L1/L0，L2 与 L3 之间 SHALL NOT 互相依赖。外部资源（上游 provider、全局库目录、项目配置、审计 journal）SHALL 仅经 L1 能力访问，L2/L3/GUI SHALL NOT 直触。

#### Scenario: 产品包零互相依赖

- **WHEN** 检查 `@morphixai/mxenv` 与全局 CLI 的包依赖清单
- **THEN** 两者均不依赖对方，各自只依赖 `@morphixai/mxenv-core` 或零依赖

#### Scenario: 契约入口纯无 IO

- **WHEN** 消费方仅 import `@morphixai/mxenv-core/contracts`
- **THEN** 不发生任何文件、网络或进程访问（schema/引用语法/类型/redaction 规则皆为纯定义）

### Requirement: 值能力唯一实现与窄暴露

组合注入（`compose`）与单键揭示（`revealSingle`）的唯一实现 SHALL 位于 `@morphixai/mxenv-core` 主入口；L2、L3 与外部 SDK SHALL 仅作为调用方，GUI SHALL NOT 直连。值能力 SHALL 保持逐键揭示、单值驻留、默认锁定、值不落日志/审计/输出的既有纪律；每次值访问经该通道 SHALL 落值无关审计（键名级）。

#### Scenario: 单键揭示单调用

- **WHEN** SDK 消费方调用 `revealSingle` 请求单个键
- **THEN** 只返回该键的值，审计新增键名级揭示事件，日志与返回元数据不含其他值

#### Scenario: 上层不实现解密

- **WHEN** 检查 L2/L3 源码与依赖
- **THEN** 不存在第二套值解密/揭示实现（dotenvx/keytar 等 IO 依赖不出现于产品包）

### Requirement: 项目态写操作版本对齐

全局 CLI 在项目作用域执行写操作（修改项目来源/配置）时 SHALL spawn 项目本地 CLI（解析顺序 cwd → `node_modules/.bin` → PATH，与 `ensureCommand` 一致）以对齐项目钉定版本；SHALL NOT 以全局侧自身版本直接改写项目数据。无法解析到项目本地 CLI 时 SHALL 明确失败并给出安装指引。

#### Scenario: 项目写走本地版本

- **WHEN** 项目 `node_modules` 内装有 `@morphixai/mxenv@0.12.x`、全局 CLI 为另一版本，全局侧对该项目执行来源写操作
- **THEN** 实际写入由项目本地 0.12.x CLI 执行，结果与项目版本行为一致

#### Scenario: 无本地 CLI 时明确失败

- **WHEN** 目标项目未安装 `@morphixai/mxenv` 且 PATH 中无解析结果
- **THEN** 命令失败并提示先在项目内安装，不静默以全局版本改写

### Requirement: 项目装即完整可用

仅项目级安装（devDep / `npx @morphixai/mxenv`，无全局 CLI、无 daemon）SHALL 提供完整运行面：`run`/`export`/`inspect`、来源管理命令（sources 按项目任选编排 provider 与 profile，**定制上游**）、`migrate`、编辑。组合语义 SHALL 为：`process.env` → 全局库 → 项目 sources（含 local `env.local`）→ `-f` override（后者优先）；无配置项目 SHALL 默认组合全局库。全局变量与项目 `env.local` SHALL 可并用，任何能力 SHALL NOT 因未安装全局 CLI 而缺失。

#### Scenario: 零全局依赖运行

- **WHEN** 项目仅以 devDep 安装 `@morphixai/mxenv`（或 `npx` 调用），机器无全局 CLI
- **THEN** run/export/inspect/来源管理/migrate/编辑全部可用

#### Scenario: 组合链优先级

- **WHEN** 同名键存在于多个层（`process.env`、全局库、项目 sources、`-f` 覆盖）
- **THEN** 按链 `process.env` → 全局库 → 项目 sources → `-f` override 组装，`-f` 值最终生效；sources 之间的显式 `override` 冲突检查语义不变

#### Scenario: 无配置项目吃全局库

- **WHEN** 项目无 `mxenv.config.json` 且机器存在全局库
- **THEN** `mxenv run` 组合出全局库变量，不报错

### Requirement: 全局增强只做加法

全局 CLI 安装 SHALL 只增加管理能力（`shell-init` 等机器级能力；Wave B 的 `gui`/`global`/`host` 同则），项目级命令的名称与行为 SHALL 不因全局安装与否而变化。命令面以 `mxenv` 品牌呈现：项目装提供 `mxenv` 命令面，全局装提供 `mxenv-cli` 管理命令（统一入口/可选模块发现属后续演进，见 design D6）。

#### Scenario: 装全局前后行为一致

- **WHEN** 同一项目分别在"仅项目装"与"项目+全局装"下执行 `mxenv run -- true`
- **THEN** 命令行为与组合结果一致，全局装仅多出管理子命令
