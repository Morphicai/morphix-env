# Design

## Context

全局库 `~/.mx-env/`（加密值 + 全局 `config.json` + 隐式 `.env` + shim 清单）是存量用户的机器态家底；命名全切（`mxenv-naming-cutover`）把新家定为 `~/.mxenv/`。行为契约见 `specs/home-migration/`。migrate 命令已有"备份 → 值级等价验证 → 失败回滚、值不落输出"纪律（plaintext-retirement），目录搬迁复用同一纪律。

约束：目标目录已存在时禁止覆盖（语义危险）；验证必须在切换前完成（失败窗口最小）；全程值不落输出（含错误路径）。

## Goals / Non-Goals

**Goals:**

- `migrate --home` 可备份、可验证、可回滚、幂等、值不落输出。
- 未迁移用户零断供：读回落 + 一次性迁移提示。

**Non-Goals:**

- dotenvx/keychain 明文迁移（plaintext-retirement）；配置双读/写落新名（naming-migration）。
- 自动迁移（不弹窗不隐式搬迁，用户显式执行）；两目录合并（语义危险，拒绝）。

## Decisions

### D4 `migrate --home` 策略：copy → 验证 → swap，旧目录改名留备份

1. `~/.mxenv/` 已存在 → 拒绝覆盖（人工处置）；否则 copy `~/.mx-env/` → `~/.mxenv/`（含权限位，0600 检查不变）。
2. 值级等价验证：迁移前后对全局库组合做键集 + 逐键值比对（复用 migrate 的 `verificationEnv`/hermetic 纪律）。
3. 通过 → `~/.mx-env` 改名为 `~/.mx-env.backup-<timestamp>`（不删除，可回滚）；失败 → 删半成品 `~/.mxenv/` 还原，退出非零。
- 备选：原地 rename（无法做"验证后再切换"，失败窗口大）；合并两目录（语义危险，拒绝）。

## Risks / Trade-offs

- [验证窗内双目录并存] → 并存期只读新目录（spec 明确），旧目录此时仅是备份前身；验证失败即删半成品，不落双源状态。
- [备份目录累积] → 保留至用户自行删除（与 migrate 文件备份同则）；stderr 提示备份路径。

## Migration Plan

1. **开发**：`migrate --home` 实现（L2 `mxenv` 命令面）+ 全局目录解析回落，五场景 + 幂等/回落三组用例全绿。
2. **验证**：sandbox 临时 HOME 走完整迁移链（旧目录读取 → migrate --home → 等价 → 回滚演练），`openspec validate --strict mxenv-home-migration`。
