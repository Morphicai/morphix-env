# Tasks

## 1. dev-only 标记与可选提醒

- [x] 1.1 `src/cli.ts` cmdInspect：provider 为 `local` 的源行尾追加 `[plaintext, dev-only]`；测试断言 local/dotenvx 两侧输出
- [x] 1.2 `src/cli.ts`：`Args` 增加 `warnPlaintext`；`--warn-plaintext` flag 接入 parser；组合路径（run/export/render/generate）在 flag 或 `MXENV_WARN_PLAINTEXT=1` 时对 loaded 且有 key 的 local 源输出一次 stderr 提醒（指向 `mx-env migrate`，值-free，once-per-process）；测试覆盖默认静默/flag/env 三态
- [x] 1.3 help 文案补 `--warn-plaintext`

## 2. migrate 核心：discovery 与 plan

- [x] 2.1 `src/migrate.ts` 新建：单元模型（kind: global-implicit | declared；name、scope、baseDir、files、source、configPath）；`discoverPlaintextUnits(layers)` 产出三类单元（隐式文件存在且嗅探无双标记、全局/项目声明的 local 源）；legacy 文件提示；单测覆盖三类发现与"已加密隐式文件不再列出"
- [x] 2.2 plan 渲染（值-free：单元名/文件路径/key 名/计划动作）与 `--to`/`--dry-run`/`--source`/`--service` 参数解析校验（`--service` 必须搭配 `--source`；`--to` 只认 dotenvx|keychain；keychain 目标遇全局隐式单元 → 跳过+提示）；`src/cli.ts`：`migrate` 命令接线、Args 增加 `to`/`service`、help 文案；RESERVED_SHIM_NAMES 补 migrate

## 3. dotenvx 目标执行路径

- [x] 3.1 `src/migrate.ts`：备份原语（0600；config 备份同规）；`encrypt -f --no-native`（评审 B1：钉死文件模型，私钥不进 OS keychain）；快照/验证（`decrypt --stdout --no-native` + dotenv.parse 精确 map 等价——评审 H1：不走 `run` 的 env 注入语义；过滤 DOTENV_PUBLIC_KEY 头）；失败回滚（还原文件与 config、报备份路径）；备份删除提醒
- [x] 3.2 声明源 config 改写（JSON round-trip 2 空格；provider→dotenvx；files 裁剪为存在子集；备份在先）；全局隐式单元跳过 config 改写；git 仓库内 `.env.keys` 未 ignore → stderr 强警告（不阻断）；跨单元共享文件 → CLI 硬失败列出冲突（评审 M2）
- [x] 3.3 `src/composition.ts`：全局隐式源嗅探（DOTENV_PUBLIC_KEY + encrypted: 双标记，评审 L4）→ dotenvx provider 构造；`src/sources.ts`：globalImplicit dotenvx 路径 `.env.keys` 存在即 0600 门禁（不存在不炸——DOTENV_PRIVATE_KEY env 模型合法；allowInsecureGlobal/win32 豁免）；`resolveDotenvx` 加 `--overload` 对齐"文件值优先"（评审 H1）；`assertSafeGlobalFile` provider 硬编码修正（评审 L5c）；两侧单测

## 4. keychain 目标执行路径

- [x] 4.1 `src/migrate.ts`：keychain 执行（macOS + keytar 前置检查；service 默认 `mx-env:<source>`；setPassword 逐 key → keytar 读回等价验证 → config 改写为 os-keychain（保留 override、丢弃 optional）→ 删除明文文件）；失败回滚保持明文与 config
- [x] 4.2 keychain 测试（macOS + keytar 可用时）：临时 service 名迁移后组合等价、明文已删、清理 keychain 测试残留

## 5. 审计与端到端

- [x] 5.1 migrate 执行写 value-free 审计事件（profile=migrate、单元名、key 名、outcome、耗时）；e2e 回归断言无值
- [x] 5.2 临时 HOME e2e：local 源 → `--to dotenvx` → 加密文件无明文、`.env.keys` 0600、配置已改写、迁移后 `run` 子进程值一致（REDACTED 输出证明注入）、audit 有 migrate 事件、重跑幂等
- [x] 5.3 全局隐式 e2e：`~/.mx-env/.env` → `--to dotenvx` → 组合等价且 config 零改动；`.env.keys` 权限放宽 → 组合硬失败（--allow-insecure-global 豁免）
- [x] 5.4 负路径：dotenvx CLI 缺失报错含安装指引且明文不动；`--service` 无 `--source` 报错；`--to` 非法值报错；dry-run 零写入；未知 flag 硬失败；dotenvx 集成测试 pin DOTENVX_NO_NATIVE（止住 keychain 泄漏）
- [x] 5.5 全量测试绿（`pnpm test`），连续 3 次无 flake
- [x] 5.6 review 修复（生产就绪视角 H1-H3 + L1-L6）：失败路径回报保留备份（cli `Backup retained (0600)`）；restoreBackups 改 lastIndexOf+逐条容错；`.env.keys` 逐文件即时 chmod、失败清理本次新建（不动既有）；keychain 回滚只删本次新建条目；声明但缺失文件裁减时警告；测试 env 剥离 DOTENV_KEY/INFISICAL_*；keytar 不可用显式告警不假绿；嗅探收紧为行锚定 `KEY=encrypted:` 双标记；嗅探误判时错误文案带提示
- [x] 5.7 边角回归测试（评审清单机械固化）：备份名含标记的还原正确性（config 只读强制中途失败实证）、多文件 later-wins 等价、跨单元共享文件守卫（零写入实证）、嗅探抗注释误判

## 6. 文档与收口

- [x] 6.1 README：新增 `mx-env migrate` 章节（范围/两目标/dry-run/备份与回滚/幂等/no-native 文件模型）；"Choosing providers" 处钉死 local=仅开发用；agent 消费指引（run --serve 为推荐形态，#4 P3 落地后形成完整链路）；dotenvx provider --overload 语义注记
- [x] 6.2 skill/SKILL.md：补 dev-only 定位与 migrate 指引；agent 场景继续推 run --serve
- [x] 6.3 CHANGELOG 0.10.0 草稿条目（含 --overload 行为变更注记）；`openspec validate plaintext-retirement --strict` 通过
- [ ] 6.4 独立 code review（正确性 + 生产就绪/token 出域四面双视角）→ 修复门禁项 → PR → 用户确认合并 → 0.10.0 发版（npm publish 前向用户确认）→ 关闭 issue #7
- [ ] 6.5 向用户报告：本次开发期在本机 login keychain 遗留的 `dotenvx (<pubkey>)` 孤儿条目（native custodian 实证 + 旧集成测试泄漏），由用户决定是否清理
