# Proposal

## Why

Wave A 收口后本地 token 治理缺"随时可开的可视化管理"一角：看值只能开 15 分钟编辑器会话，机器级的键总览、审计回看与安全揭示没有面板入口。`docs/ux-architecture.md` 2.3 已定方向（本地面板 + 值安全 API），L1 `revealSingle`（0.13.0）已就位并被编辑器收敛——本 change 落**面板宿主与值安全 API 面**，是 Wave B 的地基与 revealSingle 的第二个消费方。

形态经独立架构评审定案（2026-11-09，用户拍板）：**会话式面板宿主**而非常驻 daemon——复用编辑器会话机（spawn detached + 随机端口 + TTL + 显式关），"暴露面随使用生灭"；常驻化（launchd 托管、TTL 翻无限）与契约正交，留作真实消费者出现后的独立 change。

## What Changes

- 新增**会话式面板宿主**：`mxenv gui` 起宿主会话（loopback 127.0.0.1、随机端口、会话 token 落 0600 `runtime.json`、TTL 4h + 空闲 30 分钟关、显式 `close` 即终），`--attach` 复用已运行会话、`status`/`close` 管理。
- 新增 **panel API**（值安全面）：`GET /keys`（names-only 资源模型：profile → source → keys）、`POST /unlock|lock`（解锁窗口）、`POST /reveal`（揭示唯一入口 `revealSingle`，`Cache-Control: no-store`）。
- **消费者边界（红线）**：`reveal`/`unlock` 只供人操作的面板会话消费；Agent/脚本/自动化只准消费 names-only 面——SKILL 红线同步补"不调用 host reveal/unlock 端点"。
- 解锁窗口=显式解锁 + **墙钟判定**（每次请求校验，防睡眠冻结定时器绕过）+ 空闲自动锁（只计 reveal/unlock/lock 显式动作，面板轮询不续命）。
- 审计并轨：`via: 'host'`；记账范围=值相关与状态转换（reveal/unlock/lock/认证拒绝/会话启停），names-only 查询不记账（防灌爆注册视图）；`AuditEvent` 补 `configPath`（值无关，注册视图前置）。
- 契约 additive（mxenv-core minor）：`RevealSubject` 扩 `'host'`、`AuditEvent.via` 扩 `'host'`、`action` 扩 `'unlock' | 'lock'`、`configPath?` 字段。
- 常驻化后置：launchd 托管、TTL 翻无限、稳定端点消费者接入留独立 change（契约零变更增量）。

## Capabilities

### New Capabilities

- `panel-host`: 面板宿主的行为契约——会话生命周期与 token 认证、默认锁定与解锁窗口、reveal API 消费者边界与值安全面、审计记账范围与 configPath、并发互斥。

### Modified Capabilities

（无 spec 级行为变化——`RevealSubject`/`via`/`action`/`configPath` 均为 L0 契约 additive 字段扩展（值域枚举扩充，对穷尽 switch 是编译期变化、对 jsonl 读侧 additive）；value-reveal 的"请求方标识"未钉值域、揭示纪律不变。）

## Impact

- **mxenv-core**（minor）：契约四项 additive + `host-runtime` 能力（runtime.json 0600 读写/清除/并发锁，L1 纪律）。
- **mxenv-cli**（minor）：`mxenv gui` 命令组（宿主会话 + panel API + status/close/attach）；宿主是 L3 产品逻辑经 L1 能力（revealSingle/审计/config），不 import L2 包（产品包零依赖纪律）。
- **mxenv**（跟随）：run/edit 审计写侧补 `configPath`。
- **运行时目录**：`~/.mxenv/host/`（0700；`runtime.json` 0600：port/pid/token/startedAt，会话消亡即清）。
- **测试面**：宿主 API 集成测试（临时 HOME + 假 token）；并发互斥/墙钟窗口/审计范围扩展 core 既有测试钉；全门护航。
- **非目标**（design 记录理由）：面板 UI 与审计查看器/注册视图（`mxenv-panel-ui`，B2）；常驻化（launchd/TTL 无限/稳定端点）；云面板；项目态写操作经宿主（保持 spawn 项目本地 CLI 纪律）。
