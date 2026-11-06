# Tasks

## 1. migrate --home 迁移工具

- [ ] 1.1 实现 `mxenv migrate --home`（copy → 值级等价验证 → 旧目录改名 `~/.mx-env.backup-<ts>`；目标已存在拒绝；验证失败删半成品还原；全程值不落输出），验证 spec home-migration 五组场景测试全绿
- [ ] 1.2 幂等与兼容读取收口：已迁移报告无操作、未迁移时组合命令正常并 stderr 一次性提示、两目录并存只读新目录，验证三组用例

## 2. 验证 gate

- [ ] 2.1 sandbox 验证：临时 HOME 走完整迁移链（旧目录读取 → migrate --home → 等价 → 回滚演练），验证 spec 场景逐条复现 + `openspec validate --strict mxenv-home-migration` 通过
