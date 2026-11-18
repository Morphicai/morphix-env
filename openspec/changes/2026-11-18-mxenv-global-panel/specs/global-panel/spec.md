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

宿主 SHALL 在 `GET /{token}/` 校验 path 内 token 后返回面板静态资产；资产内嵌会话 token 供后续 API 以 Bearer 携带；token 缺失/错误 SHALL 404 且不区分"无此路径"与"token 错"。面板资产 SHALL NOT 内含任何密钥值；bundle 发布 SHALL 经构建产物哈希校验。

#### Scenario: 错误 token 不泄露存在性

- **WHEN** 请求 `/{错误token}/`
- **THEN** 返回 404，响应体与未知路径一致；事件入审计

### Requirement: 多范围 names-only 读

`GET /scopes` SHALL 返回全局、projects.json 项目、remotes.json 远程三类范围；`/keys?scope=global|project:<name>` SHALL 返回该范围的 names-only 键模型（源→键名），项目读 SHALL 在宿主进程内以项目 `baseDir` 完成；无效或未登记 scope SHALL 404。跨范围读 SHALL NOT 合并返回（保持范围隔离，防组合面泄漏）。

#### Scenario: 项目范围不串全局键

- **WHEN** `GET /keys?scope=project:demo`
- **THEN** 仅返回 demo 项目声明的源与键名；全局基线键不出现（它们属 `scope=global`）

### Requirement: 供应商读视图（providers as first-class）

面板 SHALL 把密钥供应商实例作为一等对象展示（全局与各项目范围）：每源显示 provider 类型、连接/健康状态、Infisical env 钉定状态、dotenvx 文件形态（加密/明文）、os-keychain service 与声明键、Doppler/plugin 同理。供应商视图 SHALL 为 names/status-only（无值）。接线编辑（增删改源、改钉定、写 config.json）SHALL NOT 属本 change（见 `provider-wiring-edit` change）。

#### Scenario: 供应商状态可见、接线不可改

- **WHEN** 面板查看某项目的供应商视图
- **THEN** 可见每源类型/健康/env 钉定/文件形态；不提供任何修改接线的入口（编辑属 provider-wiring-edit）

### Requirement: 解锁窗口内的写回管理

`POST /set`/`POST /delete` SHALL 仅在解锁窗口内且请求携带面板客户端标识头时执行，动作核 = L1 `edit-actions`（文件嗅探、文件序、审计构造）；适用面 = 全局基线与项目的 local/dotenvx 文件源；每个写动作 SHALL 记审计（`via: 'host'`，含 scope/key/action，不含值）。锁定态或边界缺失 SHALL 403 并审计。写端点 SHALL NOT 接受远程 provider（Infisical/Doppler）目标。

#### Scenario: 锁定态写被拒

- **WHEN** 面板未解锁时 POST /set
- **THEN** 403，审计记录拒绝，文件系统无变更

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
