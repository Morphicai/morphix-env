# Design

## Context

命名四散（`mx-env`/`morphix-env`/`mx-env.config.json`/`~/.mx-env/`/`mx-env-provider-*`/`mx-env://`），方向稿 `docs/ux-architecture.md` 已定统一为 `mxenv` 族；行为契约见 `specs/`（naming-migration 垫片契约 + plaintext-retirement/visual-editor 改名 delta）。结构前提见 `mxenv-package-split`（三包拆分）；全局目录搬迁工具见 `mxenv-home-migration`。

约束：`src/refs.ts` 已实现 `mx-env://` 解析（改名即改实现，无存量消费者已实证——`~/.trellis` 与全仓无真实引用）；`mxenv://` 须抢在 Trellis W2 实施前定案；弃用提示不得污染 stdout（`export` eval 场景）。

## Goals / Non-Goals

**Goals:**

- 一次 BREAKING 窗口（0.12.0）完成命名全切，垫片保证存量用户无感升级一个 minor 周期。
- 一切写出面（配置、引用、迁移产物、帮助、文档）只用新名，机器可验证（rg gate）。

**Non-Goals:**

- `migrate --home` 与旧目录兼容读取（`mxenv-home-migration`）。
- 三包结构（`mxenv-package-split`）；daemon/面板/`gui`/`global`/`host`（Wave C 前的 Wave B）；icon/README 重排/gitleaks（Wave C）。
- 契约语义演进（组合优先级、审计字段、值纪律只随命名平移，不改行为）。

## Decisions

### D3 命名映射与垫片实现

| 面 | 新名 | 垫片（0.12.x 内） |
|---|---|---|
| bin | `mxenv` | `mx-env`、`morphix-env` 两个 alias bin → 同入口，stderr 弃用提示一次 |
| npm | `mxenv`/`mxenv-core`/`mxenv-cli` | 旧包 `morphix-env` deprecate 指路 |
| scheme | `mxenv://` | 无垫片，解析到 `mx-env://` 即报错提示（零存量消费者，已核 `~/.trellis` 与全仓无真实引用） |
| 配置 | `mxenv.config.json` | 读双认（新优先）；写只落新名，来自旧文件时备份+改名 |
| 全局目录 | `~/.mxenv/` | 读回落（新缺旧补，stderr 提示）；`migrate --home` 搬迁（见 home-migration） |
| 插件 | `mxenv-provider-<plugin>` | 解析双认（新优先） |
| keychain 默认 service | `mxenv:<source名>` | 旧 service 名由配置携带，读取照常（不重迁移） |

弃用提示只进 stderr（`export` eval 场景 stdout 必须纯净）。

### D7 开源基础件

LICENSE（MIT 全文，版权人 `Morphicai`）、SECURITY.md（GitHub Private Vulnerability Reporting 为披露渠道 + 响应承诺 + 支持版本表）。CONTRIBUTING/issue 模板推 Wave C（控制范围）。

### D8 Trellis W2 文案同步（跨仓，随本 change 附带）

Trellis `openspec/changes/mx-env-secret-source/` 文案：`mx-env://` → `mxenv://`、SDK 消费依赖改为 `mxenv-core`。只改 change 文案，不实施 W2。

## Risks / Trade-offs

- [垫片窗口双配置歧义]（新旧 config 并存）→ 读侧确定性优先序 + 弃用提示；0.13 移除垫片时 grep 全仓文档清旧名。
- [keychain service 默认名切换后跨项目撞车面不变] → 维持既有"子集比对+警告"语义；旧 service 名配置携带不迁移。
- [本机 zshrc/skill/Trellis 遗漏旧名] → 迁移清单任务化，`rg 'mx-env'` 全仓+本机配置做验收 gate。

## Migration Plan

1. **开发**：`mxenv-package-split` 挪完文件后统一改名（sed + 人工复核）：refs scheme 切换、bin alias、配置/插件双读、keychain 默认 service、shim 清单位置；docs/skill 同步。
2. **验证**：单测/类型/构建绿 + `openspec validate --strict mxenv-naming-cutover` + `rg` 旧名清零（垫片代码与 CHANGELOG 除外）+ 双视角 review + token 出域审计。
3. **发布**：npm 发 `mxenv-core`/`mxenv`/`mxenv-cli` 0.12.0（须用户逐项放行）→ 发 `morphix-env@0.12.0`（内部转发+弃用提示）→ `npm deprecate morphix-env` → GitHub Release notes 列迁移表。
4. **本机迁移**：全局装新包、`migrate --home`、zshrc eval 行改 `mxenv export`、skill 重装、Trellis W2 文案同步。
5. **回滚**：npm `dist-tag` 指回 0.11.0；本机 `~/.mx-env.backup-<ts>` 改名还原（home-migration）；垫片窗口内旧 bin 仍可用。

## Open Questions

- Wave A 后 `morphix-env` 旧包保留多长 deprecate 指路期（建议至 1.0，Wave C 定）。
- 全局 CLI 包名 `mxenv-cli` 发布前最终确认（`mxenv-package-split` Open Questions 同步跟踪）。
