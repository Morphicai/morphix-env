# Spec Delta

## Purpose

全局面板的行为契约：已托管范围的枚举（项目注册表/远程登记）、面板 UI 服务与认证、多范围 names-only 读、解锁窗口内的写回管理、常驻生命周期，以及贯穿全程的值红线——为"本机 + 经 SSH 的远程机"提供统一管理面。

## ADDED Requirements

### Requirement: 项目注册表

宿主 SHALL 维护 `~/.mxenv/projects.json`（0600）登记已托管项目：条目含 `name`/`path`/`addedAt`/`lastSeenAt`。项目级 run/edit 首次成功组合 SHALL 幂等登记（仅当目录存在 `.mxenv/` 或 config 层）；`panel add`/`panel remove` SHALL 显式增删；`MXENV_NO_PROJECT_REGISTRY=1` SHALL 完全旁路登记；`panel remove --prune` SHALL 清除 path 已不存在的条目。注册表读写 SHALL NOT 写值或 token。

#### Scenario: 首次组合登记且幂等

- **WHEN** 同一项目目录第二次 run 成功
- **THEN** projects.json 中该 path 仍只有一个条目，仅 `lastSeenAt` 刷新（同会话 60s 内不重复写）

#### Scenario: 无 mxenv 痕迹的目录不登记

- **WHEN** 一个既无 `.mxenv/` 目录也无 config 层的 cwd 下 run -f 成功
- **THEN** 该目录不被登记

### Requirement: 面板 UI 服务与认证

宿主 SHALL 在 `GET /{token}/` 校验 path 内 token 后返回面板 HTML；通用 React bundle SHALL 在浏览器运行时从当前 path 取会话 token，后续 API 以 Bearer 携带，HTML/bundle SHALL NOT 内嵌 token、密钥值或序列化 API 状态。HTML SHALL 引用内容寻址的外置 JS/CSS，JS SHALL 带 SHA-256 integrity，资源路由 SHALL 重新校验 token + hash，CSP SHALL 由响应头发送。token 缺失/错误 SHALL 404 且不区分"无此路径"与"token 错"；bundle 发布 SHALL 经构建产物哈希校验。

#### Scenario: 错误 token 不泄露存在性

- **WHEN** 请求 `/{错误token}/`
- **THEN** 返回 404，响应体与未知路径一致；事件入审计

### Requirement: 多范围 names-only 读

`GET /scopes` SHALL 返回全局、projects.json 项目、remotes.json 远程三类范围；`/keys?scope=global|project:<name>` SHALL 返回该范围的 names-only 键模型（源→键名），包含 Infisical/Doppler 等外部供应商，并为每行返回 `provider`、`source` 与继承标记；项目读 SHALL 在宿主进程内以项目 `baseDir` 完成；无效或未登记 scope SHALL 404。跨范围读 SHALL NOT 合并返回（保持范围隔离，防组合面泄漏）。

#### Scenario: 项目范围不串其他项目键

- **WHEN** `GET /keys?scope=project:demo`
- **THEN** 返回 demo 默认 profile 的声明源与键名；继承的全局基线键明确标记 `inherited`，其他项目的 local/provider 键不出现

### Requirement: 供应商读视图（providers as first-class）

面板 SHALL 把密钥供应商实例作为一等对象展示（全局与各项目范围）：每源显示 provider 类型、连接/健康状态、Infisical env 钉定状态、dotenvx 文件形态（加密/明文）、os-keychain service 与声明键、Doppler/plugin 同理。供应商视图 SHALL 为 names/status-only（无值）。接线编辑（增删改源、改钉定、写 config.json）SHALL NOT 属本 change（见 `provider-wiring-edit` change）。

#### Scenario: 供应商状态可见、接线不可改

- **WHEN** 面板查看某项目的供应商视图
- **THEN** 可见每源类型/健康/env 钉定/文件形态；不提供任何修改接线的入口（编辑属 provider-wiring-edit）

### Requirement: 外部供应商 names-only 与逐键揭示

`/keys` SHALL 通过 L1 同一来源加载器枚举所有已配置 provider 的键名，包括 Infisical/Doppler；响应 SHALL NOT 包含值。单个外部来源不可用 SHALL NOT 阻塞其他来源的键名与健康卡片返回。

外部 provider 的 `POST /reveal` SHALL 复用 `revealSingle` 与现有面板边界头、unlock 窗口、scope 隔离、单值驻留和 `no-store`；UI SHALL 90 秒自动隐藏，审计 SHALL 只记键名/来源/结果。远程 provider 的 set/delete SHALL 继续拒绝。

#### Scenario: Infisical 键名可见且响应无值

- **WHEN** 已配置且可用的 Infisical 来源参与某项目 profile
- **THEN** `/keys` 返回其键名、provider=`infisical` 与 source，响应不包含任何上游值

#### Scenario: 解锁后逐键查看外部值

- **WHEN** 人类面板在有效 unlock 窗口内 reveal 一个 Infisical 键
- **THEN** 仅该键值以 `no-store` 返回，90 秒自动隐藏并记录无值审计；锁定或其他范围请求不能复用该结果

#### Scenario: 外部读取不扩大为远程写

- **WHEN** 外部 provider 键出现在 Keys 表
- **THEN** 可 reveal，但不出现 set/delete 控件，直接调用远程写端点仍被拒绝

### Requirement: 快照读取与短期缓存

宿主 SHALL 提供 `GET /snapshot?scope=&profile=`，在一次来源加载中同时返回该范围的 names-only 键与供应商状态；`/keys` 与 `/wiring` SHALL 保持兼容。来源加载 SHALL 使用有界并发，dotenvx CLI 调用 SHALL 异步执行，单源失败 SHALL 不阻塞其他来源。

面板 SHALL 以 scope/profile 隔离内存读缓存，fresh 快照 SHALL 在 60 秒内复用；写回或 Refresh SHALL 使受影响 scope 失效。缓存 SHALL NOT 持久化，也 SHALL NOT 保存 reveal 值、token 或编辑表单。

#### Scenario: 切换范围不重复请求新鲜快照

- **WHEN** 用户在 60 秒内从 Global 切换到项目再切回 Global
- **THEN** 新鲜快照从对应 scope 的内存缓存复用，不重复加载上游，且不显示另一 scope 的键

#### Scenario: 写回后读取新快照

- **WHEN** 当前 scope 的 set/delete 或接线写成功
- **THEN** 该 scope 的快照失效并重新加载，其他 scope 的缓存不被混入

### Requirement: Agent 输入请求

`mxenv gui request KEY [--scope] [--reason]` SHALL 生成指向面板的输入请求深链：URL SHALL 只携带键名与说明（≤200 字符），SHALL NOT 携带值；scope 未显式给定时 SHALL 解析为 cwd 对应项目（不可用时 global 并提示）。面板在解锁后 SHALL 打开预填该键的输入表单（已有键定位其来源；新键优先项目 local 源，全局 scope 用全局基线），提交走既有 unlock + 二次确认 + 无值审计；请求参数消费后 SHALL 从 URL 移除。锁定态 SHALL 仅展示提示，不出现任何值。无效键名或未登记 scope SHALL 拒绝退出 1。

#### Scenario: Agent 请求经面板输入

- **WHEN** Agent 以 `gui request API_TOKEN --reason "deploy needs it"` 打开面板且人类解锁后输入
- **THEN** 值直达所选密钥源，审计不含值；URL 的 request/reason 参数在表单打开时被移除，刷新不再重开

#### Scenario: 值不经过 Agent

- **WHEN** 人类通过输入请求表单提交值
- **THEN** 请求 URL、终端输出与审计都不包含该值；Agent 侧仅能通过 `run` 注入获得该键

### Requirement: 解锁窗口内的写回管理

`POST /set`/`POST /delete` SHALL 仅在解锁窗口内且请求携带面板客户端标识头时执行，动作核 = L1 `edit-actions`（文件嗅探、文件序、审计构造）；适用面 = 全局基线与项目的 local/dotenvx 文件源及 os-keychain 已声明键；每个写动作 SHALL 记审计（`via: 'host'`，含 scope/key/action，不含值）。锁定态 SHALL 423、边界缺失 SHALL 403并审计。写端点 SHALL NOT 接受远程 provider（Infisical/Doppler）目标。

#### Scenario: 锁定态写被拒

- **WHEN** 面板未解锁时 POST /set
- **THEN** 423，审计记录拒绝，文件系统无变更

### Requirement: 常驻生命周期

`mxenv gui install` SHALL 生成并装载 launchd（macOS）/ systemd --user（Linux）单元；`serve --daemon` 会话 SHALL TTL 无限、空闲只锁定不关闭；`uninstall` SHALL 移除单元终止会话。常驻 SHALL NOT 改变锁定默认（面板仍默认锁定）、loopback 绑定与 unlock 窗口语义。`--port` 固定端口 SHALL 为显式选项并在 install 输出中附带暴露面提示。

#### Scenario: 常驻空闲后是锁定不是死亡

- **WHEN** daemon 会话空闲超时
- **THEN** 会话存活、状态为 locked；unlock 仍可用

### Requirement: 远程范围登记与隧道契约

`~/.mxenv/remotes.json`（0600）SHALL 登记远程 `{name, host, port?, transport:'ssh'}`；面板远程范围 SHALL 经 SSH 本地转发消费**同一套宿主 API**；远程 token SHALL NOT 落盘于本机（经 SSH 执行远程 attach 获取一次性 URL）；远程面板上的动作 SHALL 在远程本机审计。本契约 SHALL NOT 引入云 relay、TLS 终结或公网直连。

#### Scenario: 远程动作远程记账

- **WHEN** 经隧道在远程范围 reveal 一个键
- **THEN** 审计事件写入远程机 `~/.mxenv/audit/`，本机审计不含该事件与该值
