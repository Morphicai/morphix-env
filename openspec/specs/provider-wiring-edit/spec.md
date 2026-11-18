# provider-wiring-edit Specification

## Purpose
供应商接线编辑（增删改源、env 钉定）作为面板管理面的高危操作独立成能力：原子写与备份回滚、二次确认门禁、doctor 单源测试、`mxenv edit` 并入面板的迁移契约。

## Requirements

### Requirement: 接线编辑动作核（原子写与回滚）

L1 `config-actions` SHALL 提供 add/remove/update source、Infisical env 钉定、legacy 迁移等接线动作：写项目 `mxenv.config.json` 前 SHALL 生成 0600 备份（`mxenv.config.json.bak`，写失败 SHALL 回滚原文件），每次动作 SHALL 产出变更前后 diff 摘要（源名/provider/顺序/钉定，不含任何值）。接线编辑 SHALL 一次只操作一个源（无批量编辑）；profile 的数组与 `{ sources: [...] }` 两种合法形态均 SHALL 保留。

#### Scenario: 写失败回滚

- **WHEN** `mxenv.config.json` 写入失败（磁盘满/权限）
- **THEN** 原文件内容不变，0600 的 `mxenv.config.json.bak` 保留写入前内容，动作报错并审计 failure

### Requirement: 接线写端点门禁（二次确认）

`POST /wiring-preview` SHALL 只读生成 diff 与指纹；`POST /wiring-write` SHALL 仅在解锁窗口内、携带 `x-mxenv-panel` 边界头、显式项目 scope、且请求携带用户确认过的 diff 指纹时执行。服务端 SHALL 从当前配置重新计算指纹，不匹配 SHALL 以 409 拒绝（防盲改/重放陈旧确认）。每个成功接线动作 SHALL 记审计（`via: 'host'`，含脱敏 before/after 摘要，不含值）。边界缺失返回 403，锁定返回 423，指纹缺失/格式非法返回 400。

#### Scenario: 陈旧确认被拒

- **WHEN** 用户在 UI 确认 diff 后、提交前接线又被另一动作改动，提交时使用旧 diff 指纹
- **THEN** 服务端重新计算的指纹不匹配，返回 409 并提示刷新预览；当前配置不被覆盖

### Requirement: doctor 单源测试面板化

面板 SHALL 提供单源"测试连接"动作：read-only 组合该源并展示健康结果（与 `mxenv doctor` 判定同源），SHALL NOT 触发任何写或值展示。

#### Scenario: 失败源给出可行动信息

- **WHEN** Infisical 源 token 失效时点"测试连接"
- **THEN** 展示失败原因与指路（更新 token 的途径），不展示任何值

### Requirement: `mxenv edit` 并入管理面板

编辑器 SHALL 成为面板的项目范围编辑形态（同一 token/解锁窗口/审计流）；`mxenv edit` 命令 SHALL 保留并改为打开面板对应项目范围（深链接直达该项目键表）；一次性编辑器服务 SHALL 在面板编辑形态验收后移除。迁移期内两形态 SHALL NOT 并存写同一文件（编辑器会话互斥沿用宿主锁纪律）。

#### Scenario: edit 命令直达项目范围

- **WHEN** 在项目目录运行 `mxenv edit`
- **THEN** 打开面板该项目范围页（若面板未运行则先起临时会话），编辑动作走面板写端点门禁与审计
