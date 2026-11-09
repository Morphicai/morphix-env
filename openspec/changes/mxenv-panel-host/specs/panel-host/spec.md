# Spec Delta

## Purpose

面板宿主的行为契约：会话式本地 API、token 认证、默认锁定与解锁窗口下的值安全揭示（唯一入口 revealSingle、消费者边界钉死）、审计记账范围与 configPath——为本地面板（B2）与常驻使用提供不出机器的机器级管理面。

## ADDED Requirements

### Requirement: 会话生命周期与 token 认证

面板宿主 SHALL 以会话形态运行：绑定 127.0.0.1 随机端口，会话 token 落 `~/.mxenv/host/runtime.json`（0600，含 port/pid/startedAt），会话 TTL 上限 4 小时、空闲 30 分钟关、显式关闭即终；会话消亡 SHALL 清除 runtime 文件。API 请求 SHALL 持有效 token（`Authorization: Bearer`），缺失或错误 token SHALL 被拒绝并审计；token SHALL NOT 出现在命令行参数、日志或审计事件中。宿主启动 SHALL 以文件锁互斥（同名锁 `O_EXCL` 语义）：并发启动只产生一个会话，其余幂等附着或退出。

#### Scenario: 无 token 拒绝且 token 不落日志

- **WHEN** 本机请求未携带有效 token
- **THEN** 请求被拒绝并记审计；token 不出现在任何日志、审计事件或 argv 中

#### Scenario: 会话终止即失效

- **WHEN** 会话 TTL 到期、空闲超时或显式关闭后用旧 token 请求
- **THEN** 连接拒绝（宿主已停），runtime.json 已清除

#### Scenario: 并发启动只一个会话

- **WHEN** 两个 `mxenv gui` 同时启动
- **THEN** 文件锁保证只产生一个宿主会话；另一方幂等附着到已运行会话或明确退出

### Requirement: 默认锁定与解锁窗口

宿主 SHALL 默认锁定：锁定态只提供键名与状态（names-only），值揭示 SHALL 被拒绝。解锁 SHALL 显式发生并只开有限窗口（默认 15 分钟）；窗口判定 SHALL 以墙钟时间戳在**每次请求**校验（定时器仅兜底，睡眠/时钟跳变不失效）；空闲自动锁（默认 5 分钟）只计 reveal/unlock/lock 显式动作，面板轮询（names-only 查询）SHALL NOT 续命。

#### Scenario: 锁定态只出键名

- **WHEN** 处于锁定态请求键列表
- **THEN** 返回键名与来源/状态，不含任何值；值揭示请求被拒（locked 审计）

#### Scenario: 窗口按墙钟到期

- **WHEN** 解锁后系统睡眠超过窗口 TTL，唤醒后再请求值揭示
- **THEN** 揭示被拒绝（locked 审计）——窗口按墙钟已过期

#### Scenario: 轮询不续命空闲锁

- **WHEN** 解锁后面板仅轮询 names-only 查询、无显式动作
- **THEN** 空闲自动锁按期触发，后续揭示被拒

### Requirement: 揭示消费者边界与值安全

值揭示 SHALL 经 value-reveal 能力（revealSingle）唯一实现：逐键、单值驻留（驻留槽=宿主会话，新揭示清旧驻留，锁回/TTL 到期时面板 SHALL 清除已展示值）、揭示对象为来源存储值。揭示与解锁端点 SHALL 只供**人操作的面板会话**消费；Agent、脚本与其他自动化消费方 SHALL 只使用 names-only 面（键列表/状态），MUST NOT 调用揭示或解锁端点。值 SHALL 仅在 provider 与揭示响应之间传输：MUST NOT 出现在日志、审计事件、错误信息或任何持久化中间产物中；揭示响应 SHALL 标记不可缓存（`Cache-Control: no-store`）；宿主 SHALL NOT 缓存或持久化值。

#### Scenario: 逐键揭示与单值驻留

- **WHEN** 解锁窗口内请求揭示键 A、随后请求键 B
- **THEN** 各返回且仅返回所请求键的存储值（响应 no-store），键 A 的驻留被键 B 清除

#### Scenario: 自动化消费方只准 names-only

- **WHEN** 非面板会话的消费方（Agent/脚本）调用揭示或解锁端点
- **THEN** 请求被拒绝并审计；其可用面仅限键名与状态

#### Scenario: 揭示路径错误不含值

- **WHEN** 揭示失败（键不存在、读取失败或锁定）
- **THEN** 错误与审计事件均不含任何密钥值

### Requirement: 审计记账范围与 configPath

宿主 SHALL 对值相关与状态转换操作记值无关审计（`via: 'host'`）：揭示、解锁、锁定、认证拒绝、会话启动/关闭；names-only 查询（键列表/状态轮询）SHALL NOT 记账。审计事件 SHALL 携带配置来源路径 `configPath`（值无关；配置文件实际存在时为该路径，否则 `'-'` 占位——不得写入未存在的幻影路径）；运行面 run/edit 的审计写 SHALL 同步携带该字段，供项目注册视图聚合。

#### Scenario: 值操作记账、查询不记账

- **WHEN** 一次解锁 + 一次揭示 + 若干次键列表查询
- **THEN** 审计恰新增解锁与揭示两条 `via: 'host'` 事件（含键名与结果、不含值），查询无事件

#### Scenario: configPath 只记真实路径

- **WHEN** run/edit/host 在有配置与无配置的目录各产生一条审计事件
- **THEN** 前者含该配置文件路径，后者为 `'-'`，无未存在路径

### Requirement: 会话宿主生命周期命令

`mxenv gui` SHALL 启动宿主会话并打开面板入口（无会话则起、有会话则附着）；`mxenv gui status` SHALL 报告运行态/端口/锁定态（值无关）；`mxenv gui close` SHALL 显式关闭会话并清 runtime 文件。命令 SHALL 幂等。

#### Scenario: 一条命令进入面板

- **WHEN** 执行 `mxenv gui`（无已运行会话）
- **THEN** 宿主会话启动并在 <1s 内给出面板 URL；再次执行附着已运行会话而不产生第二实例

#### Scenario: close 后旧 token 落空

- **WHEN** `mxenv gui close` 后用旧 token 请求
- **THEN** 连接拒绝且 runtime.json 已清除
