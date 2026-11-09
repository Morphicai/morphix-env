# Design

## Context

分层与值安全边界见 `docs/ux-architecture.md` 2.2/2.3（L0–L3 依赖只向下；值能力唯一实现在 L1；GUI 不碰文件不碰值）。安全模型自评已明："同一 uid 下 daemon 进程本就可读文件，靠进程隔离是神话"——安全目标是**暴露面收窄与全量审计**，不是防同 uid 攻击者。形态经独立架构评审（2026-11-09）定案：会话式面板宿主而非常驻 daemon——对以"值不出机器/Agent 上下文零密钥"为品牌承诺的密钥工具，暴露面应随使用生灭；常驻化与契约正交（residency 是进程生命周期策略），留真实消费者出现后增量。编辑器（`editor.ts`：spawn detached + 随机端口 + 握手 + TTL）是已验证的会话机先例。

## Goals / Non-Goals

**Goals:**
- 面板宿主作为 revealSingle 的第二个消费方，揭示纪律零分叉（唯一实现 + 消费者边界）。
- "一条命令进入可视化管理"：`mxenv gui` <1s 起面板，长驻浏览（审计回看）由 4h TTL + attach 支撑。
- 为 B2 面板（`mxenv-panel-ui`）提供完整契约（API 资源模型 + runtime 发现 + L0 类型），B2 不碰文件不碰值。

**Non-Goals:**
- 面板 UI、审计查看器、项目注册视图（`mxenv-panel-ui` B2）。
- 常驻化：launchd 托管、TTL 翻无限、稳定端点消费者接入（独立 change，契约零变更）。
- 云面板与任何值出机器的通道。
- 项目态写操作经宿主（保持 spawn 项目本地 CLI 版本对齐纪律）。

## Decisions

1. **会话式宿主，复用编辑器会话机模式**。`mxenv gui`（L3，`mxenv-cli` 的预留命令骨架落位）spawn detached 宿主：`listen(0, '127.0.0.1')` 随机端口、stdout 握手回 URL、TTL 4h + 空闲 30 分钟关、显式 close 即终；`--attach`/`status` 经 runtime 发现复用已运行会话；URL 经 runtime 发现文件回传（父进程短轮询 ≤100ms，行为等价握手——实现定案，早期"stdout 握手"表述废弃）。宿主实现是 L3 产品逻辑经 L1 能力（revealSingle/审计/config），**不 import L2 包**（产品包零依赖纪律）；会话机模式借鉴 `editor.ts` 而非跨包 import。备选（常驻 daemon + launchd）被评审否决：复杂度集中在产品收益最薄处（launchd/pid 互认/路径漂移），且造出全案最大常驻暴露面；常驻化后置为"翻 TTL + 加托管"的零契约增量。

2. **runtime.json 三合一（port/pid/token），0600 随会话生灭**。与编辑器 URL-token 的差异=attach 需要可重新获取 token（长会话 tab 关后重开）；token 落盘换取 attach 能力，但 0600 + 会话消亡即清 + TTL 上限把 standing exposure 压到会话窗内。拆分 token 到独立文件无安全增益（同 uid 同为 0600 可读）——三合一省一次读，取舍如上，防止将来"拆个 token 文件更安全"的假优化。宿主启动以 `O_EXCL` 文件锁互斥（check-then-act 的 pid 互认不是锁），并发启动只产生一个会话。

3. **解锁窗口：墙钟判定 + 显式动作才续命**。`POST /unlock` 开窗（默认 15 分钟），窗口有效性以 `unlockAt + TTL < now` 在**每次请求**判定（setTimeout 会被 macOS 睡眠冻结，纯定时器实现可被合盖绕过）；空闲自动锁（默认 5 分钟）只计 reveal/unlock/lock 显式动作，面板 names-only 轮询不续命。解锁/锁定各记审计。**诚实定位**：同 uid 不设防前提下，窗口是"人操作的刻意性门槛 + 肩窥收窄"，不是安全边界——真正的边界是消费者边界（决策 4）+ 唯一实现 + 审计。

4. **消费者边界钉死**。`POST /reveal` 与 `POST /unlock` 只供人操作的面板会话消费；Agent/脚本/自动化只准 names-only 面。理由：reveal 进 Agent 工具结果=值进对话与模型上下文，"值不出机器"被击穿（SKILL 红线"不在对话/终端展示值"的等价约束）。同 uid 无法硬隔离（决策 3 诚实定位），但契约必须钉死——否则下一个消费方会把 reveal 顺手接进去；SKILL 红线同步补"不调用 reveal/unlock 端点"。

5. **API 资源模型**（B2 契约基座）：`GET /keys` = `[{key, source, fileIndex?, status}]`（names-only，按 profile 维度可选过滤 `?profile=`）。键面口径=**本地可枚举来源全集**：local/dotenvx/os-keychain/plugin 声明 keys，多文件来源逐 `fileIndex` 枚举（与揭示的单文件作用域对称）；infisical/doppler 需网络与上游凭据，键面留后续扩（不静默混入总览）。`POST /reveal` = `{key, source, fileIndex?}`（来源归属由调用方指名——与编辑器页内揭示的 fileIndex 语义对齐，同名跨文件不串读；同名来源后序获胜），响应 `Cache-Control: no-store`；`POST /unlock|lock` 无 body；`GET /status` = `{locked, startedAt}`（names-only）。L0 类型随任务 1.1 导出。

6. **审计记账范围枚举**。只记值相关与状态转换：reveal / unlock / lock / 认证拒绝 / 会话启停（`via: 'host'`）；names-only 查询不记账——常驻面板轮询下"每次操作都记"会灌爆 journal，稀释 2.4 注册视图"最近使用/频率"信号。契约面：`AuditEvent.via` 扩 `'host'`、`action` 扩 `'unlock' | 'lock'`（枚举扩展对穷尽 switch 是编译期变化、对 jsonl 读侧 additive）。

7. **configPath 只记真实路径**。`AuditEvent.configPath?: string`；写侧判 `project.exists`（`loadConfigAt` 在文件不存在时仍返回候选路径——直接取 `project.path` 会写入幻影路径）再取 path，否则 `'-'`（与 profile 缺省占位同风格）。已知口径注明：`loadProjectConfig` 只查 cwd 一层不上溯，子目录运行落 `'-'`——是否上溯解析归 B2 注册视图议题。

8. **host-runtime 下沉 L1**。`~/.mxenv/host/`（0700）的 runtime.json 读写/0600 保证/O_EXCL 锁/清除由 mxenv-core 提供；真实消费方=mxenv-cli 命令面与未来 SDK（面板经 API 不读文件——ux 红线"GUI 不碰文件"）。理由：ux 纪律"外部资源一律经 L1 能力访问"，权限保证单点。

## Risks / Trade-offs

- [loopback 同 uid 可达任意进程] → 不承诺防同 uid；边界=消费者边界 + 唯一实现 + 默认锁定 + 逐键窄暴露 + 全量审计。token 防跨用户与误连。
- [token 落盘（runtime.json）] → 0600 + 会话消亡即清 + 4h TTL 上限；换取 attach 能力（决策 2 取舍记录）。
- [解锁窗口长开] → 墙钟 TTL + 显式动作空闲锁双保险，unlock/lock 审计可回看；面板协作条款要求锁回清已展示值。
- [B2 面板契约漂移] → 资源模型（决策 5）+ L0 类型导出先行；reveal 请求形状（key+source+fileIndex）与 value-reveal 语义对齐。
- [token 经浏览器 URL 传输，`open` 的 argv 瞬时可见（macOS `ps` 跨用户可见命令行）] → 与已发布的编辑器先例同级的接受面；token 防跨用户是弱保证（0600 文件同理），真正的边界是消费者边界+审计。更强方案（一次性跳转页/无 argv 传输）留有真实威胁模型时再议。
- [常驻化后置的消费者等待] → 触发器明确：云 relay 定案 / Agent 轮询真实需求 / 用户反馈敲命令是摩擦——届时翻 TTL + 加托管，契约零变更。

## Migration Plan

无数据迁移。`~/.mxenv/host/` 首次使用创建（0700）。发版：mxenv-core minor（契约 additive + host-runtime）+ mxenv-cli minor（gui 命令组）+ mxenv 跟随（审计 configPath），lockstep 四 manifest 并**同步 workspace 依赖 specifier**（0.13.1 教训）。回滚 = revert 单提交，无状态残留。

## Open Questions

无——形态（会话式）、消费者边界、API 资源模型、窗口时基、审计范围、并发互斥、configPath 口径均已在 Decisions 定案。
