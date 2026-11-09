# Spec Delta

## Purpose

为全局目录一次性迁移（`~/.mx-env/` → `~/.mxenv/`）与兼容读取定契约：copy → 旧目录改名留时间戳备份 → 值级等价验证，可回滚、幂等、值不落输出；未迁移时兼容读取不断供。

## ADDED Requirements

### Requirement: 全局目录一次性迁移

`mxenv migrate --home` SHALL 将全局目录从 `~/.mx-env/` 迁移至 `~/.mxenv/`：迁移前留时间戳备份，迁移后做值级等价验证（全局库键集与逐键值一致），验证失败 SHALL 自动回滚，全程输出不含任何密钥值。目标目录已存在时 SHALL 拒绝覆盖并给出人工处置指引。重复执行幂等（已迁移则报告无操作）。兼容窗口内 `~/.mxenv/` 不存在时，读取回落 `~/.mx-env/` 并提示迁移；两目录并存时只读新目录。

#### Scenario: 迁移成功且等价

- **WHEN** 仅 `~/.mx-env/` 存在，执行 `mxenv migrate --home`
- **THEN** 全局库移至 `~/.mxenv/`，迁移前后组合出的全局键集与值一致，旧目录留有时间戳备份

#### Scenario: 目标已存在拒绝覆盖

- **WHEN** `~/.mxenv/` 已存在时执行 `mxenv migrate --home`
- **THEN** 无任何写入，输出冲突说明与人工处置指引

#### Scenario: 验证失败回滚

- **WHEN** 迁移后值级等价验证失败
- **THEN** 从备份还原 `~/.mx-env/`（新目录不留半迁移状态），退出码非零，stderr 指明备份路径

#### Scenario: 值永不出现

- **WHEN** `migrate --home` 任意子路径执行（成功或失败）
- **THEN** stdout/stderr 均不含任何密钥值（key 名允许）

#### Scenario: 未迁移时兼容读取

- **WHEN** 仅 `~/.mx-env/` 存在时执行任意组合命令
- **THEN** 全局库正常加载（行为与迁移后一致），stderr 给出一次性迁移指引
