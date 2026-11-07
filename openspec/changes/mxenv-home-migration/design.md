# Design

## Context

全局库 `~/.mx-env/`（加密值 + 全局 `config.json` + 隐式 `.env` + shim 清单）是存量用户的机器态家底；命名全切（`mxenv-naming-cutover`）把新家定为 `~/.mxenv/`。行为契约见 `specs/home-migration/`。migrate 命令已有"备份 → 值级等价验证 → 失败回滚、值不落输出"纪律（plaintext-retirement），目录搬迁复用同一纪律。

约束：目标目录已存在时禁止覆盖（语义危险）；备份必须先于验证（失败可还原），验证在目标独立生效后立即执行；全程值不落输出（含错误路径）。

## Goals / Non-Goals

**Goals:**

- `migrate --home` 可备份、可验证、可回滚、幂等、值不落输出。
- 未迁移用户零断供：读回落 + 一次性迁移提示。

**Non-Goals:**

- dotenvx/keychain 明文迁移（plaintext-retirement）；配置双读/写落新名（naming-migration）。
- 自动迁移（不弹窗不隐式搬迁，用户显式执行）；两目录合并（语义危险，拒绝）。

## Decisions

### D4 `migrate --home` 策略：copy → 旧目录改名备份 → 验证，失败整目录还原

1. `~/.mxenv/` 已存在 → 拒绝覆盖（人工处置）；否则 copy `~/.mx-env/` → `~/.mxenv/`（含权限位，0600 检查不变；先拷临时名 `~/.mxenv.partial-<ts>` 再改名入位，半拷贝相位不落生效名）。
2. 迁移前留时间戳备份：旧目录改名 `~/.mx-env.backup-<timestamp>`（不删除，可回滚）；目标内同步落 `.mxenv-verify-pending` 验证标记（验证通过才删）。
3. 值级等价验证：迁移前后对全局库组合做键集 + 逐键值比对（复用 migrate 的 `verificationEnv`/hermetic 纪律；快照只计库键，PATH/HOME 等底座键不入账）。
4. 通过 → 删验证标记 + 重接 shim PATH（rc 标记块按新 shimsDir 重写，新旧双认）；失败 → 从备份整目录还原 + 清半成品，退出非零。
- **综合裁决（与初稿顺序差异）**：初稿写"copy → 验证 → 通过后改名"，与 spec 验证失败场景"从备份还原、stderr 指明备份路径"矛盾（失败时备份必须已存在）、亦被 requirement"迁移前留时间戳备份，迁移后验证"排除。实际序取 requirement + 场景为权威；原约束"验证必须在切换前完成（失败窗口最小）"改述为"备份先行保证失败可还原，验证在目标独立生效后立即执行"——收益是显式旧路径引用断裂被真实暴露（测试真实触发）。
- **crash 窗口账目**：copy 中崩溃→仅留临时名残留（下次迁移清扫）+ 旧库完好；改名备份后、验证完成前崩溃→`.verify-pending` 在场，重跑**回滚重启**（重新快照→copy→备份→验证），绝不把未验证态报成 already migrated；验证通过后、标记删除前崩溃→同左，重跑重做验证。任一窗口不落"未验证却当已迁移"状态；backup rename 前崩溃=目标（含 `.mxenv-verify-pending`）与旧目录并存，由标记回滚重启自愈；conflict 分支只接**无标记**双目录（人工态）。
- 备选：原地 rename（无法做"验证后再切换"，失败窗口大）；合并两目录（语义危险，拒绝）。

## Risks / Trade-offs

- [迁移相位的可见性] → 半拷贝以临时名入位，验证窗内旧目录已是备份前身：并存读者任一相位只见完整的旧库或完整的新库（spec"两目录并存只读新目录"）；验证失败即整目录还原，不落双源状态。
- [备份目录累积] → 保留至用户自行删除（与 migrate 文件备份同则）；stderr 提示备份路径。

## Migration Plan

1. **开发**：`migrate --home` 实现（L2 `mxenv` 命令面）+ 全局目录解析回落，五场景 + 幂等/回落三组用例全绿。
2. **验证**：sandbox 临时 HOME 走完整迁移链（旧目录读取 → migrate --home → 等价 → 回滚演练），`openspec validate --strict mxenv-home-migration`。
