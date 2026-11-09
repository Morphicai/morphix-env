# Tasks

## 1. L1 契约与 host-runtime（mxenv-core）

- [x] 1.1 契约 additive 四项：`RevealSubject` 扩 `'host'`、`AuditEvent.via` 扩 `'host'`、`action` 扩 `'unlock' | 'lock'`、加可选 `configPath` 字段；L0 类型导出面同步（`/contracts` 与主入口）并导出 panel API 资源模型类型（决策 5 的 keys/reveal 请求形状），验证三包编译零破坏（枚举扩展的穷尽 switch 影响面清点）
- [x] 1.2 实现 `host-runtime`（`~/.mxenv/host/` 0700 目录、runtime.json 0600 读写/清除、`O_EXCL` 启动锁、幂等与旧文件覆盖），验证单测覆盖权限位/锁互斥/清除/并发启动只一个会话
- [x] 1.3 revealSingle 的 host 消费面测试：`subject: 'host'` 记 `via: 'host'`、锁定拒绝/驻留互斥沿用（value-reveal 既有测试钉扩一组 host 维度用例）

## 2. 会话宿主与 panel API（mxenv-cli）

- [x] 2.1 会话宿主（L3 经 L1 能力、不 import L2）：spawn detached + `listen(0,'127.0.0.1')` + runtime 发现文件回 URL（父进程短轮询）+ Bearer token 认证（token 不进 argv/日志/审计）+ TTL 4h/空闲 30 分钟关 + 显式 close 清 runtime.json，验证集成测试（临时 HOME + 假 token：无 token 拒绝、会话终止即失效、token 不落日志）
- [x] 2.2 panel API 资源模型与消费者边界：`GET /keys`（names-only、`?profile=` 过滤）、`POST /reveal`（`{key, source, fileIndex?}` 经 revealSingle、单值驻留 slot=会话、`Cache-Control: no-store`）、`POST /unlock|lock`（墙钟窗口判定 + 只计显式动作的空闲锁）；非面板会话调用 reveal/unlock 拒绝并审计（SKILL 红线同步补"不调用 reveal/unlock 端点"），验证测试覆盖：锁定态只出键名/墙钟到期拒绝（假时钟）/轮询不续命/消费者边界拒绝/驻留互斥/错误与响应无值
- [x] 2.3 审计记账范围：reveal/unlock/lock/认证拒绝/会话启停记 `via: 'host'`（含 configPath），names-only 查询不记账，验证测试断言"解锁+揭示+若干查询恰两条事件"
- [x] 2.4 并发与附着：`O_EXCL` 锁下并发 `mxenv gui` 只一个会话、`--attach` 复用、`status` 报运行态/端口/锁定态，验证并发用例

## 3. 命令面（mxenv-cli）

- [x] 3.1 `mxenv gui [--attach]` / `gui status` / `gui close` 落位（替换预留骨架；帮助文本注明 gui 由管理面提供、与 `mxenv edit` 分工），验证命令测试（一条命令进入/幂等附着/close 清文件）与帮助断言

## 4. 审计 configPath 写侧（mxenv）

- [x] 4.1 run/edit 审计写侧补 `configPath`：判 `project.exists` 再取 path、否则 `'-'`（不写幻影路径），验证测试断言两种口径 + 旧事件缺字段读侧容忍

## 5. 收口

- [x] 5.1 运行 `pnpm -r test` + `pnpm test` 全门与三包 typecheck（发版门纪律见记忆 mxenv-parseargs-parity-full-gate；本 change 不改 parseArgs flag 仍随全门复核）
- [x] 5.2 文档口径：docs/ux-architecture.md 2.3 状态注记（会话式定案、常驻化后置触发器）、SKILL/README 补 `mxenv gui` 面与消费者红线，验证文档互校无矛盾
- [ ] 5.3 发版 mxenv-core（minor）+ mxenv-cli（minor）+ mxenv（跟随），lockstep 四 manifest **同步 workspace 依赖 specifier**，两机对齐验证 npm 落地与 `skill show` 同版（**发布须用户逐项放行**）
