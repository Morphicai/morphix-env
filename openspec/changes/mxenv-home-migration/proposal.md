# Proposal

## Why

命名全切（`mxenv-naming-cutover`）把全局目录定为 `~/.mxenv/`，但存量用户的全局密钥库在 `~/.mx-env/`。全局库是加密值的家，搬迁必须沿用 migrate 既有纪律（备份、值级等价验证、可回滚、值不落输出），不能让用户手搬目录。本 change 把 `migrate --home` 与旧目录兼容读取独立成可验证的交付单元；读回落保证不迁移也不断供，与命名 change 可并行开发、同批 0.12.0 发布。

## What Changes

- **`mxenv migrate --home`**：copy `~/.mx-env/` → `~/.mxenv/`（含权限位，0600 检查不变）→ 值级等价验证（全局库键集 + 逐键值）→ 旧目录改名 `~/.mx-env.backup-<timestamp>` 留备份；目标目录已存在拒绝覆盖并给人工处置指引；验证失败删半成品还原、退出非零；全程输出不含任何密钥值；重复执行幂等（已迁移则报告无操作）。
- **兼容读取**：兼容窗口内 `~/.mxenv/` 不存在时，读取回落 `~/.mx-env/` 并给一次性迁移提示；两目录并存时只读新目录。

## Capabilities

### New Capabilities

- `home-migration`: 全局目录一次性迁移与兼容读取契约——copy → 值级等价验证 → 旧目录改名备份、拒绝覆盖、失败回滚、值不落输出、幂等、未迁移时回落读取不断供。

## Impact

- 代码：`migrate` 命令面（L2 `mxenv`）加 `--home` 子路径，等价验证复用 migrate 的 hermetic 纪律；全局目录解析加旧名回落与提示。
- 不改：dotenvx/keychain 明文迁移行为本身（plaintext-retirement）；配置双读与写落新名（naming-migration req2）。
- 依赖：目录新名语义来自 `mxenv-naming-cutover`；发布与本机迁移清单并入该 change 的 4.x。
