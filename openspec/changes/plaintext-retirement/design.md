# Design

## Context

mx-env 0.9.0 已发布：五种 provider（含 dotenvx 加密文件、os-keychain）就位，`run --serve` 提供消费端"值不进 env"，shim 解决入口摩擦。现存弱点是**存量明文**：`~/.mx-env/.env`（全局隐式源，11-04 事故文件）与各项目声明的 `local` 源仍以明文落盘。本 change 提供一键迁移与定位标记，不引入新加密机制（dotenvx/keychain 都是既有 provider）。

## Goals / Non-Goals

**Goals:**
- 一条命令把现存明文迁入加密存储，全过程可 dry-run、有备份、值级等价验证、失败可回滚
- 迁移后组合行为对外不变：同一 profile 组合出同一批 key 与值
- local 明文的"仅开发用"定位在 inspect/文档/可选提醒三处钉死

**Non-Goals:**
- 新加密机制、keychain 原生 API/Touch ID（#4 P3）、网络层 proxy（#4 远期）
- legacy `.env.local`/`envFiles` 的自动迁移（见决策 8）
- 团队/远程场景（Infisical/Doppler 的迁入）——本 change 只管本地明文
- Windows 的 keychain 目标（与既有 provider 支持面一致，仅 macOS）

## Decisions

### 1. 迁移单元 = 一个 local 源；三类可迁移单元

discovery 产出单元清单，每单元独立执行、独立验证：

| 单元 | 来源 | dotenvx 目标 | keychain 目标 |
| --- | --- | --- | --- |
| 全局隐式 `~/.mx-env/.env` | 硬编码 globalImplicit 源 | 原地加密（配置零改动，决策 2 嗅探接管加载） | **不支持**（它不经过 profiles，config 声明无法等效接管，见决策 3） |
| 全局 config 声明的 local 源 | `~/.mx-env/config.json` sources | 原地加密 + provider 字段改 dotenvx | values 入 keychain + provider 改 os-keychain |
| 项目 config 声明的 local 源 | `mx-env.config.json` sources | 同上 | 同上 |

无 `--to` 的 `migrate` 是纯只读 plan（打印单元、文件路径、key 名清单、计划动作）；`--to` 才进入执行。`--dry-run` 与 `--to` 组合时输出完整执行计划但零写入——两道门独立：忘了 `--to` 不会写入，带了 `--to` 也可以先 dry-run。

### 2. 全局隐式文件的加密感知：嗅探，不改配置

`~/.mx-env/.env` 被 dotenvx 原地加密后，硬编码的 globalImplicit 源必须改以 dotenvx 加载，否则加密文本被 dotenv 解析成垃圾键。方案：组合层构造 globalImplicit 条目时嗅探文件内容——同时含 `DOTENV_PUBLIC_KEY` 头与至少一个 `encrypted:` 值即以 dotenvx provider 构造（files/optional 不变；双标记避免明文文件合法定义同名 key 被误判）。嗅探是一次同步 read（该文件本来就要读），配置零改动、无状态漂移点。备选"迁移时往全局 config 写显式源"被否：隐式源无条件加载、显式源要走 profile，两者并存会把同一文件加载两次且语义分裂。

对称门禁：globalImplicit 走 dotenvx 路径时，`<dir>/.env.keys` **存在则**套用与明文时代相同的 0600 检查（`--allow-insecure-global` 豁免，win32 豁免；文件不存在不炸——`DOTENV_PRIVATE_KEY` env 注入是 dotenvx 官方支持的模型）——`.env.keys` 就是新的明文等价物。

### 2a. migrate 钉死 dotenvx 文件模型（`--no-native`）——评审实证 B1

dotenvx 2.30 在 macOS 上默认走 native custodian：私钥直接写 OS Keychain（service `dotenvx (<pubkey>)`），**不产生 `.env.keys`**；CI=true 时又禁用。若不加干预，本 change 的整套落盘纪律（0600 门禁、git-ignore 警告、备份叙事）门禁的是一个不确定存在的文件，且本机/CI 行为分裂。裁定：migrate 的 `encrypt` 与验证用 `decrypt` 一律带 `--no-native`，强制文件模型——可移植（`.env.keys` 可分发的官方模型）、与门禁设计自洽、跨机/CI 行为一致。存量用户自行用 native 模式加密的文件不受影响（resolveDotenvx 不 pin，keychain 路径照常解密）。

### 2b. dotenvx provider 对齐"文件值优先"（`--overload`）——评审实证 H1

`dotenvx run` 默认不覆盖既有环境变量：shell 已导出同名 key 时，组合结果拿到的是 shell 旧值而非文件值——而 local 源是文件值无条件赢。明文用户最常见的状态恰是 shell 里导出了 key，不处理则"迁移后组合行为不变"对该人群不成立。修复：`resolveDotenvx` 的 `run` 加 `--overload`，文件值优先，与 local 语义对齐（行为变更写入 CHANGELOG；方向是 bug 修复）。

### 3. keychain 目标只服务声明源；service 命名 `mx-env:<source>`

声明源迁 keychain 后，config 中该源改写为 `{provider:'os-keychain', service}`（`override` 保留；`optional` 丢弃——validateConfig 禁止远程源 optional）。service 默认 `mx-env:<source名>`；`--service` 覆盖仅在与 `--source` 单选同用时合法（多源共用一个 service 会造成 key 互相覆盖）。全局隐式文件不给 keychain 目标：它的加载不经 profile 声明，无法用"改写声明"完成切换，强行走 keychain 要求发明新的隐式 keychain 概念——超范围。

### 4. 执行顺序：验证先于改写，回滚靠备份

每个单元的执行序（dotenvx 声明源为例；其余形态同构）：

1. **快照**：parseEnvFile 按序合并出 `{key: value}`（内存，不落盘不打印）
2. **备份**：每个明文文件 → `<file>.mx-env-backup-<ISO时间戳>`，0600
3. **写目标**：dotenvx `encrypt -f --no-native`（cwd=文件目录，保证 `.env.keys` 落在文件旁——与 resolveDotenvx 的 cwd 假设一致）；keychain `setPassword` 逐 key
4. **验证**：dotenvx 目标走 `decrypt --stdout --no-native` + dotenv.parse 与快照做**精确 map 等价**——不走 `run`：run 的子进程 env 含本进程变量，遮蔽语义会造成假 mismatch（决策 2b）；keychain 目标经 `loadSource` 读回比对
5. **改写配置**（声明源）：备份 config → JSON round-trip 改写 → dotenvx 目标的 files 列表只保留迁移时实际存在的文件（dotenvx provider 对"声明但缺失"的文件硬失败，local 是跳过——不裁减会造成迁移后组合回归）
6. **清理明文**：keychain 目标删除明文文件（dotenvx 目标原地加密后无明文残留）

任一步失败：中止该单元，已改 config 从备份还原，明文文件保持/还原，stderr 给出备份路径与手动回滚指引；其余单元不受影响。验证不过而目标已写入时（如 keychain 已 setPassword）不回头删 keychain——备份在手，幂等重跑会覆盖同 key。

**跨单元文件共享守卫**：两个单元引用同一明文文件时无法独立迁移（第一个迁移后第二个的快照为空、config 被指向空存储）。discovery 后 CLI 检测文件重叠并硬失败，列出冲突文件与单元名，由用户拆分配置后重跑。

### 5. 备份与 `.env.keys` 的落盘纪律

- 备份一律 0600，路径打印（内容永不打印），成功收尾时提醒"确认稳定后删除备份"
- dotenvx 加密产物 `.env.keys`：chmod 0600；文件位于 git 仓库内且未被 ignore → 强警告（dotenvx 模型下加密 .env 可入库，`.env.keys` 绝不可）
- 迁移执行写 value-free 审计事件（profile=`migrate`、单元名、key 名、结果）

### 6. dev-only 标记：标识默认给，提醒可选

- `inspect`：provider 为 `local` 的源行尾追加 `[plaintext, dev-only]`（含隐式全局与 legacy 源）——默认行为，标识是事实陈述
- 组合路径（run/export/render/generate）：`--warn-plaintext` flag 或 `MXENV_WARN_PLAINTEXT=1` 时，对实际 loaded 且贡献了 key 的 local 源输出一次 stderr 提醒并指向 `mx-env migrate`。默认关闭（issue 明确"可选"；shim 场景传不了 flag，故同时给 env 开关）

### 7. dotenvx CLI 是 migrate 与既有 provider 的共同前置

`--to dotenvx` 需要 dotenvx CLI（node_modules/.bin 或 PATH，与 ensureCommand 同解析）。dotenvx 是 morphix-env 的 devDependency 不随包分发；缺失时硬失败并给出安装指引。这与既有 dotenvx provider 的约束一致，不新增依赖形态。

### 8. legacy 文件不自动迁移

legacy `.env.local`/`envFiles` 走的是无声明兼容路径，没有 config 条目可改写；自动迁移它等于替用户发明 sources/profiles 结构。discovery 发现 legacy 文件存在时提示"建议声明为 source 后再迁移"，不代劳。

### 9. Config 改写接受 JSON round-trip 格式归一

config 文件是严格 JSON（无注释），改写用 `JSON.stringify(2空格)+换行`，格式被归一化（既有手抖格式漂移被抹平）。这是有意的：config 由工具持续维护（shell-init 不改它，但 edit/migrate 会），归一化降低 diff 噪音；改写前有备份。

## Risks / Trade-offs

- [dotenvx encrypt 中途失败留下截断密文（dotenvx 2.30 是原地 writeFileSync，无原子 rename）] → 备份在先 + 验证失败即还原；不依赖 encrypt 的原子性
- [等价验证的"快照"与"重载"都过同一解析代码，解析 bug 两侧同错] → 快照走 dotenv.parse 明文，验证走 dotenvx CLI `decrypt`（真实解密路径），两侧独立互证；keychain 走 keytar 读回
- [迁移后旧终端/旧进程仍引用明文文件路径] → 声明源路径不变（dotenvx 原地）、provider 切换对 run 透明；keychain 目标文件被删，依赖该文件的**非 mx-env** 消费者会断——plan 与文档明确提示这一面
- [keychain 迁移在 CI/无 keytar 机器上不可用] → 目标选择即报错并指向 dotenvx；dotenvx 的 `.env.keys` 分发是用户既有模型，不替其决策
- [`.env.keys` 0600 门禁误伤存量用户] → 仅对 globalImplicit 的 dotenvx 路径启用（新形态，无存量）；项目内声明的 dotenvx 源不加门禁（`.env.keys` 在用户项目里，模型不同）

## Migration Plan

1. 分支 `feat/plaintext-retirement` 从最新 main 起步；openspec validate --strict 通过
2. 按 tasks 实施（标记 → migrate 核心 → 两目标 → 门禁 → CLI/audit → e2e → 文档）
3. 独立双视角 review（正确性 + 生产就绪/token 出域四面）→ 修复门禁项
4. PR → 用户确认合并 → 0.10.0 发版（npm publish 前单独确认；CI 发布链路仍缺 NPM_AUTOMATION_TOKEN，走本地发布）
5. 关闭 issue #7；#4 P3 保持 open 作为存储端终局

## Open Questions

- 无。（`--service` 命名、提醒开关默认态、legacy 不代劳均已在决策中定案。）
