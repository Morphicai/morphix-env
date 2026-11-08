# Proposal

## Why

0.12.0 发版时 CHANGELOG、SKILL、README 三处公告：旧 bin 名 `mx-env` / `morphix-env` 垫片保留一个 minor 周期（0.12.x），**0.13 起移除**并公告；naming-migration spec 明文"兼容垫片 SHALL 保留一个 minor 周期（0.12.x；0.13 起移除并在 CHANGELOG 公告）"。0.13.0 已发布（revealSingle）但垫片未摘——承诺已到兑现期，持续漂移即失信；文档措辞已先行精确为"0.13.x 摘除"（57ea308），本 change 是该承诺的收口（naming-cutover 的到期移除段）。

## What Changes

- **BREAKING** 摘除旧 bin 名垫片：`mx-env` / `morphix-env` bin alias 与 stderr 弃用提示退役，`mxenv` 成为唯一命令名。
- **BREAKING** 摘除 `mx-env.config.json` 读回落：配置只读 `mxenv.config.json`（写侧 0.12.0 起已落新名，读回落已存活一个 minor 周期）。
- **BREAKING** 摘除 `mx-env-provider-<plugin>` 插件名回退：插件解析只认 `mxenv-provider-<plugin>`。
- 存量 shim 兼容公告：旧生成 shim（委派 `mx-env run`）不再被 alias 兜住——CHANGELOG/SKILL/README 公告升级后重跑 `mxenv-cli shell-init` 再生成；shim 生成物的新旧双 marker 检测保留（旧 shim 仍可识别与剥离，只是不再可执行）。
- naming-migration spec delta：MODIFIED"旧名垫片与弃用窗口"为移除后语义（垫片窗关闭、到期移除已执行）。
- 文档 `rg` 清旧名（CHANGELOG 历史条目、openspec 档案、测试 fixture 语义标注除外）；测试垫片语义用例同步清理（naming-cutover 记录约 65 处）。
- 发版 0.13.1（三包 lockstep），CHANGELOG 再公告到期移除。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `naming-migration`: "旧名垫片与弃用窗口" requirement 以 REMOVED（窗口期行为，带 Reason/Migration）+ ADDED（"垫片移除与到期公告"，移除后语义）替换——垫片窗按承诺于 0.13.x 关闭；"新命名唯一生效面"不动（其语义已覆盖移除后状态）。前置：`mxenv-naming-cutover` change 归档使 naming-migration 先落主 specs（顺清长期归档挂账之一）。

## Impact

- **bin 安装面**：三包 `package.json` `bin` 字段收窄为 `mxenv`（+ mxenv-cli 的 `mxenv-cli`/`shell-init` 面不变）；npm 升级后旧 bin 链接残留的清理提示。
- **加载链**：config 加载（`loadConfig` 读回落分支）、插件解析（provider 名回退分支）删代码路径；`migrate` 的旧名提示话术更新。
- **shim 生态**：`shell-init` 生成物内容不变（已委派 `mxenv run`）；旧 shim 执行将报 command not found，公告再生成。
- **测试**：垫片语义用例删除/改写（约 65 处），双包 parseArgs parity 与 `pnpm -r test` 全门护航（发版门纪律见记忆 mxenv-parseargs-parity-full-gate）。
- **文档**：README / packages/mxenv/README / SKILL 的"0.13.x 摘除"措辞改为已执行口径；CHANGELOG 0.13.1 公告。
- **非目标（保留，理由见 design）**：`~/.mx-env/` 目录读回落（home-migration 承诺绑定 `migrate --home` 跑完而非版本号）；keychain 旧 service 名 `mx-env:<source>` 照读（配置携带、无迁移负担）；openspec 档案与 CHANGELOG 历史条目不改写。
