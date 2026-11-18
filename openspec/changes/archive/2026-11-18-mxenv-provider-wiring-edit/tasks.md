# Tasks

## 1. L1 config-actions（mxenv-core）

- [x] 动作核：add/remove/update source、Infisical env 钉定、文件序调整；一次一源，保留数组与 `{ sources }` 两种 profile 形态
- [x] 原子写：`mxenv.config.json.bak` 固定 0600 + 失败回滚 + diff 摘要与指纹（无值）
- [x] legacy 迁移：项目 `mxenv.config.json` 的 flat `infisical`/`envFiles` → 同文件现代 `sources` + `profiles`
- [x] 测试：回滚、备份失败保留原配置、diff 指纹稳定性、等价转换、脱敏 before/after 审计

## 2. 宿主端点与门禁（mxenv-cli）

- [x] `POST /wiring-preview` 只读预览；`POST /wiring-write`：unlock 窗口 + 边界头 + 显式项目 scope + diff 指纹二次确认 + 审计 `via:'host'`
- [x] 测试：锁定 423/无边界 403/陈旧指纹 409、成功路径审计、备份产物、并发修改不覆盖
- [x] `GET /doctor?scope=&source=` 单源 read-only 测试，失败不外透第三方细节

## 3. panel-ui

- [x] 供应商卡片编辑态（解锁窗口内）：添加/编辑/删除源、env 钉定选择、文件顺序；继承的 `__mx` 内部源不可编辑
- [x] 变更预览 diff + 二次确认对话框（指纹回传），并发变化要求重新预览
- [x] 单源"测试连接"按钮（read-only，可行动的通用失败提示）
- [x] legacy 迁移向导入口（等价预览→确认）

## 4. edit 并入面板

- [x] 面板项目范围编辑形态（键表 set/delete，门禁与审计并轨）
- [x] `mxenv edit` 改为打开面板项目深链接（无项目配置打开 global；`gui edit [path]` 保留 scope/profile 深链接）
- [x] 公开 CLI/help 不再启动一次性编辑器，L2 仅以 argv 委派 L3，不反向 import
- [ ] 后续删除不可达的一次性 editor 构建资产、隐藏调试入口与旧专用测试（不影响本 change 的公开行为）

## 5. 文档与收口

- [x] guide：接线编辑节（二次确认语义、备份与回滚、审计口径）
- [x] security.md：接线编辑影响面陈述（爆炸半径 > 改值）
- [x] ux-architecture.md 更新；全门测试绿；openspec strict 校验
- [ ] 用户确认后归档 change（本次实施不擅自归档）
