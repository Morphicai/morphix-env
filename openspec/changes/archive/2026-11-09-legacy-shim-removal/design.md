# Design

## Context

垫片是 naming-cutover（0.12.0）引入的到期兼容层：旧 bin 名转发 + 配置读回落 + 插件名回退，spec 承诺"保留一个 minor 周期（0.12.x；0.13 起移除并在 CHANGELOG 公告）"。0.13.0 已发布但未摘除，文档措辞已精确为"0.13.x 摘除"（57ea308）。范围与承诺面的界定见 proposal.md；shim 生成物的双 marker 识别（新旧 marker 双认、旧块可剥离）由 terminal-command-shims 已归档 spec 持有，本 change 不改识别逻辑。

## Goals / Non-Goals

**Goals:**
- 兑现到期移除：三类垫片（bin alias / config 读回落 / provider 回退）按 spec 摘除，行为契约更新为移除后语义。
- 摘除不制造静默失败：旧配置文件、旧 shim 的失效都有明确指引出口。
- 测试面同步收口，反向断言钉住"不再回落"防回归。

**Non-Goals:**
- `~/.mx-env/` 目录读回落摘除：home-migration 的兼容窗绑定"用户跑完 `migrate --home`"而非版本号（时序注在 SKILL），机器迁移进度不齐，版本化摘除会把未迁移机器打断。
- keychain 旧 service 名 `mx-env:<source>` 照读：由配置携带决定，无独立迁移负担，摘除只制造无谓迁移。
- 自动改名用户的旧配置文件/自动清理存量旧 bin 链接：写用户文件与 bin 目录的破坏性动作不做（0.12.1 非破坏 aside 原则）。
- openspec 档案、CHANGELOG 历史条目、已归档 spec 的历史表述改写。

## Decisions

1. **旧配置文件"指引而非静默、非自动迁移"**。读回落摘除后，只有 `mx-env.config.json` 的项目将无配置——加载链检测到旧文件存在且新名缺失时输出改名指引（指出 `mxenv.config.json`）。理由：静默空配置是排障黑洞；自动改名是写用户文件的破坏性动作。备选（启动时自动改名）被否：违反非破坏原则，且写侧 0.12.0 起已落新名，旧文件残留本就该由用户确认迁移。

2. **bin 摘除 = package.json `bin` 字段收窄，不做存量链接清理**。npm 升级同包时按新 bin 集重建链接，旧链接残留（指向失效路径）由 CHANGELOG 公告提示手动移除。备选（postinstall 清扫脚本）被否：碰用户全局 bin 目录风险大于收益。

3. **测试清理保留反向断言**。垫片语义用例不纯删：改为"移除后"断言（旧 bin 名不存在、旧配置不参与解析且给指引、旧插件名不回退）。理由：纯删留回归窗口；反向断言正是 spec 移除后 scenarios 的测试面。parity 双包（mxenv/mxenv-cli parseArgs 逐字节）随改动同 patch，`pnpm -r test` 全门护航。

4. **shim 识别能力不动，执行兜底摘除**。双 marker 检测（识别/剥离旧 shim）保留——它是清理工具的一部分；被摘除的只是"旧 shim 经 alias 仍可执行"这层兜底。旧 shim 执行失败的引导出口=CHANGELOG/SKILL/README 公告重跑 `mxenv-cli shell-init`。

5. **0.13.1 承载到期移除**。semver 上 0.x 的 patch 不惯承载 breaking，但本次是 0.12.0 提前公告的"到期执行"而非新引入的不兼容；且 57ea308 已把承诺锁在 0.13.x 线。备选（0.14.0）被否：与已分发的文档承诺冲突。

## Risks / Trade-offs

- [存量用户旧 shim 升级后失效（command not found）] → 三处公告 + `mxenv migrate`/旧名报错信息指向 `shell-init` 再生成；0.12.0 CHANGELOG 已提前预告。
- [未迁移项目的旧配置静默失灵] → 决策 1 的检测指引；`migrate --home` 与改名指引话术保持一致出口。
- [测试清理面广（~65 处）引入回归] → 逐类处置（删除垫片正向语义 / 保留反向断言），全门 + parity 逐字节比对；发版前 `pnpm -r test` 不以单包代替。
- [npm 升级后旧 bin 链接残留引发"装了但命令坏"的观感] → CHANGELOG 公告说明手动移除；`mxenv` 新名始终可用不受影响。

## Migration Plan

无数据/配置迁移。发版 0.13.1（三包 lockstep，CHANGELOG 公告到期移除与 shim 再生成）。回滚 = revert 单提交（bin 字段与读回落分支恢复），无状态残留。

## Open Questions

无——范围边界（保留 `~/.mx-env/` 与 keychain 旧 service 名）已裁决且理由如上，不随实施变化。
