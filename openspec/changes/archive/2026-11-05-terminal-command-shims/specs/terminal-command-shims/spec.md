# Spec Delta: terminal-command-shims

## Purpose

让被声明的终端命令在裸敲时自动经 `mx-env run` 注入组合环境：通过 PATH 前段的 shim 目录与两级命令清单实现"方便性无感"，同时保持值只进入被包裹命令的子进程这一最小暴露面。

## ADDED Requirements

### Requirement: 声明式命令清单

全局配置（`~/.mx-env/config.json`）与项目配置（`mx-env.config.json`）均可声明 `shims` 字段（命令名字符串数组）。生效清单为两级并集，去重按大小写不敏感进行。保留名（mx-env 全部 CLI 命令名、bin 名 `mx-env`/`morphix-env`、内部入口名）禁止声明。

非法条目（非字符串、空串、含 `/`、`\` 或空白字符、保留名、大小写不敏感重复）的处理分两条路径：`shell-init` SHALL 硬失败并给出指明非法项的 value-free 错误；组合路径（`run`/`export`/`render`/`generate` 等）SHALL 降级为 stderr 警告并忽略整个 `shims` 字段——shim 是便利层，SHALL NOT 成为核心注入路径的单点故障。配置中 SHALL NOT 出现任何密钥值。

#### Scenario: 全局清单声明后生成 shim

- **WHEN** 全局配置含 `shims: ["pnpm"]` 且执行 `mx-env shell-init`
- **THEN** `~/.mx-env/shims/pnpm` 被创建为可执行文件，且 stdout 提示需要加入 shell rc 的 PATH 前置行

#### Scenario: 项目清单与全局清单取并集

- **WHEN** 全局清单含 `["pnpm"]`、项目配置含 `shims: ["python"]`，在项目目录执行 `mx-env shell-init`
- **THEN** `pnpm` 与 `python` 两个 shim 均存在

#### Scenario: shell-init 对非法条目硬失败

- **WHEN** 清单含 `"../evil"` 或保留名或空串，执行 `mx-env shell-init`
- **THEN** 命令失败并给出指明非法项的 value-free 错误，不生成任何 shim

#### Scenario: 组合路径对非法条目降级

- **WHEN** 清单含非法条目，执行 `mx-env run -- <cmd>`
- **THEN** 注入正常完成，stderr 出现指明 `shims` 字段被忽略的警告，退出码不受影响

#### Scenario: 大小写不敏感去重

- **WHEN** 清单含 `["Node", "node"]`（macOS 大小写不敏感文件系统）
- **THEN** 生效清单只含一个条目，不生成两个互相覆盖的 shim 文件

### Requirement: shim 透明转发

shim 可执行文件被调用时 SHALL 以 `mx-env run -- <原命令> <原始参数>` 等价语义执行：原命令的所有参数原样传递（含以 `-` 开头的参数），退出码透传。shim 自身 SHALL NOT 输出任何组合值；其输出与错误行为与 `run` 一致（注入值在转发输出中被脱敏）。shim 脚本 SHALL 在 mx-env 不在 PATH 时给出可操作的修复指引而非裸的 `command not found`。

#### Scenario: 裸敲被声明命令获得注入环境

- **WHEN** shim 目录位于 PATH 中且被声明命令经 PATH 解析到 shim，清单声明 `pnpm`，使用者在项目目录裸敲 `pnpm dev`
- **THEN** 该进程的组合环境与显式 `mx-env run -- pnpm dev` 完全一致

#### Scenario: 退出码透传

- **WHEN** 被包裹命令以退出码 3 终止
- **THEN** shim 的退出码为 3

#### Scenario: mx-env 缺失时的可操作报错

- **WHEN** shim 存在但 `mx-env` 不在 PATH（如卸载后残留）
- **THEN** stderr 给出指明"重装或执行 shell-init --remove 清理"的错误，退出码非零

#### Scenario: 未声明命令零感知

- **WHEN** 某命令不在生效清单中
- **THEN** 该命令不经任何 shim，行为与未安装本功能完全一致

### Requirement: 递归防护

`mx-env run` SHALL 在组合开始之前净化基底 PATH：移除所有解析为 shim 目录的 PATH 条目（filter-all；大小写敏感性与平台文件系统一致），使组合期的 provider 子进程（doppler/plugin/dotenvx 等）与最终被 spawn 的子进程都拿到无 shim 的 PATH。spawn 子进程时 SHALL 再防御性剥离一次（双保险）。注入 SHALL 只发生在最外层 shim 一次；孙进程通过继承获得环境而非再次注入。剥离 SHALL NOT 影响 shim 目录之外的 PATH 项。

#### Scenario: 组合期 provider 不递归

- **WHEN** 清单声明 `node`，且某 plugin provider 脚本内部调用 `node`，经 shim 触发 `mx-env run`
- **THEN** plugin 内部的 `node` 解析到真实 node 而非 shim，组合完成无递归

#### Scenario: 子进程内再调用不再触发 shim

- **WHEN** shim 触发的 `run` 子进程内执行 `command -v pnpm`（`pnpm` 在清单中）
- **THEN** 结果是真实 pnpm 的路径而非 shim 路径，且该子进程已持有组合环境

#### Scenario: PATH 重复条目全部剥离

- **WHEN** 子进程 PATH 中 shim 目录出现两次
- **THEN** 两个条目都被移除，其余 PATH 项不变

### Requirement: 幂等的安装与卸载

`shell-init` SHALL 幂等：重复执行不产生重复 shim、不重复写入 shell rc。`shell-init --remove` SHALL 幂等地移除 shim 目录中由本工具生成的 shim（按文件头标记识别）与 rc 中由本工具写入的标记块，不触碰用户的其它 rc 内容与手工文件；发现 shim 目录中名为保留命令的手工残留文件时 SHALL 警告并提示删除。清单缩减后重新执行 `shell-init` SHALL 移除不再声明的 shim。`shell-init` SHALL 校验每个生效清单命令经当前 PATH 解析的结果是否指向对应 shim 文件，解析不到时给出 stderr 警告（不阻断）。

#### Scenario: 重复 init 无漂移

- **WHEN** 连续执行两次 `shell-init --write`
- **THEN** shim 目录内容与 rc 改动与单次执行完全一致

#### Scenario: 清单缩减收敛 shim

- **WHEN** 清单从 `["pnpm", "node"]` 改为 `["pnpm"]` 后执行 `shell-init`
- **THEN** `node` 的 shim 被移除，`pnpm` 的保留

#### Scenario: 手工残留保留名文件被警告

- **WHEN** shim 目录中存在手工创建的名为 `mx-env` 的文件，执行 `shell-init`
- **THEN** stderr 警告该文件存在并提示删除，命令继续处理其余清单

### Requirement: 审计与边界声明

shim 触发的注入 SHALL 经既有 value-free audit 通道记录，并携带 `via: "shim"` 维度（该维度是观测标记而非安全断言）。audit SHALL NOT 包含任何值、命令参数或配置内容。README 与 SKILL 文档 SHALL 明确声明边界：shim 提供方便性，注入值对同 uid 进程可见；需要对 agent 隐藏的场景 SHALL 指引至 `run --serve`。

#### Scenario: shim 命中可区分

- **WHEN** 通过 shim 触发一次 `run` 后读取当日 audit 记录
- **THEN** 记录包含 `via: shim` 维度、profile 与 key 名，且不含任何值
