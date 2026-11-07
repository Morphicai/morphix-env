# Tasks

## 1. migrate --home 迁移工具

- [x] 1.1 实现 `mxenv migrate --home`（copy → 值级等价验证 → 旧目录改名 `~/.mx-env.backup-<ts>`；目标已存在拒绝；验证失败删半成品还原；全程值不落输出），验证 spec home-migration 五组场景测试全绿（2026-11-07，migrateHome 存在性分流→快照→copyTree 含权限位→改名备份→值级等价验证→失败从备份整目录还原+删半成品；`--home` 独立模式与 --to 等互斥、仅成功写审计；五场景全绿（0600 保真/零写入快照/真实触发的失败回滚/各路径值不落输出/兼容读取）。**设计综合**：D4 "copy→验证→改名"与 spec 失败场景"从备份还原"矛盾（失败时备份须已存在）——综合为 copy→改名备份→验证（目标独立生效），验证暴露显式旧路径引用断裂，测试真实触发；crash 窗口注记：rename 前崩溃=双目录 conflict 人工处置（安全），rename 后崩溃=重跑报 already migrated（窗口极小））
- [x] 1.2 幂等与兼容读取收口：已迁移报告无操作、未迁移时组合命令正常并 stderr 一次性提示、两目录并存只读新目录，验证三组用例（2026-11-07，回落统一 resolveGlobalDir（core 新 global-home.ts）覆盖 config/auditDir/shimsDir 三点；**兼容窗内写也落旧目录**——防审计/shim 写先建 `~/.mxenv/` 令 --home 误判目标已存在；提示恰一次（migrate --home 自身抑制）；三组+沙盒全链+互斥用例绿；parseArgs parity 守卫咬住 L2 --home 漂移、L3 同步）

## 2. 验证 gate

- [x] 2.1 sandbox 验证：临时 HOME 走完整迁移链（旧目录读取 → migrate --home → 等价 → 回滚演练），验证 spec 场景逐条复现 + `openspec validate --strict mxenv-home-migration` 通过（2026-11-07，home-migration.test.ts 8 用例含沙盒全链（读取→迁移→等价→手工回滚演练→再迁移）；四套 165/88/31/11=295 全绿；validate --strict 通过）
