# Tasks

## 1. L1 config-actions（mxenv-core）

- [ ] 动作核：add/remove/update source、Infisical env 钉定、文件序调整；一次一源
- [ ] 原子写：备份 config.json.bak + 失败回滚 + diff 摘要（无值）
- [ ] legacy 迁移向导判定：package.json mxenv 字段 → .mxenv/config.json 等价转换（与 CLI migrate 同源判定）
- [ ] 测试：回滚、diff 指纹稳定性、等价转换快照

## 2. 宿主端点与门禁（mxenv-cli）

- [ ] `POST /wiring-write`：unlock 窗口 + 边界头 + diff 指纹二次确认 + 审计 via:'host'
- [ ] 测试：锁定态/无边界/陈旧指纹三重拒绝、成功路径审计、备份产物

## 3. panel-ui

- [ ] 供应商卡片编辑态（解锁窗口内）：添加/编辑/禁用源、env 钉定选择
- [ ] 变更预览 diff + 二次确认对话框（指纹回传）
- [ ] 单源"测试连接"按钮（doctor 判定同源，read-only）
- [ ] legacy 迁移向导入口（等价预览→确认）

## 4. edit 并入面板

- [ ] 面板项目范围编辑形态（键表 set/delete，门禁与审计并轨）
- [ ] `mxenv edit` 改为打开面板项目深链接（面板未运行先起临时会话）
- [ ] 一次性编辑器移除（面板编辑形态验收后）；editor-ui 资产退役
- [ ] 测试：edit 深链接路由、会话互斥

## 5. 文档与收口

- [ ] guide：接线编辑节（二次确认语义、备份与回滚、审计口径）
- [ ] security.md：接线编辑影响面陈述（爆炸半径 > 改值）
- [ ] ux-architecture.md 更新；全门测试绿；openspec 归档
