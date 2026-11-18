# Tasks

## 1. L1 能力（mxenv-core）

- [x] `projects.json` 注册表：读/幂等登记（name 冲突后缀）/ lastSeenAt 节流写 / remove / prune / `MXENV_NO_PROJECT_REGISTRY` 旁路；0600（mxenv-core/src/registry.ts；8 例 registry.test.ts）
- [x] run/edit 首次成功组合登记埋点（仅当目录存在 .mxenv/ 或 package.json mxenv 字段；cli.ts registerCurrentProject；L2 3 例集成测试）
- [ ] `remotes.json`：登记/删除/列出；0600
- [ ] `edit-actions` 提取：从 L2 editor.ts 抽白名单 set/delete 动作核（dotenvx 嗅探、文件序、审计事件构造）；L2 `edit` 改为消费之（行为零变化，既有编辑器测试护航）
- [ ] 测试：edit-actions 与编辑器行为等价（注册表幂等/节流/prune 已随 registry.test.ts 落地）

## 2. L3 宿主 API 扩展（mxenv-cli）

- [ ] `GET /scopes`：全局 + projects.json 清单 + remotes.json 清单
- [ ] `GET /wiring?scope=`：源接线与供应商状态（provider 类型/健康/Infisical env 钉定/dotenvx 文件形态/keychain service+keys；names/status only，无接线编辑——见 provider-wiring-edit change）
- [ ] `/keys?scope=`：`global` / `project:<name>`（baseDir 进程内切换）；无效 scope 404
- [ ] `POST /set` `/delete`：unlock 窗口门禁 + `x-mxenv-panel` 边界 + edit-actions 执行 + 审计 `via:'host'`；全局基线与项目 local/dotenvx 文件
- [ ] 静态 UI 服务：`GET /{token}/` token-in-path 校验 → panel bundle；token 失效即 404（与 API 同纪律）
- [ ] 测试：scopes/keys 隔离、写门禁（锁定态拒绝/边界头缺失拒绝）、审计事件、UI 路径认证

## 3. panel-ui（mxenv-cli 自有资产）

- [ ] 脚手架：React + vite + shadcn（组件从 editor-ui 拷贝同源）；构建产物入 `packages/mxenv-cli/panel-ui/`，发布打包
- [ ] 范围侧栏：全局 / 项目（from /scopes）/ 远程（from /scopes，隧道提示）
- [ ] 键表：names-only、来源/Provider 列、组合顺序标注；解锁按钮 → 窗口内 reveal（单键、点击复制）
- [ ] set/delete 对话框（值输入 type=password、二次确认、审计提示文案）
- [ ] doctor 摘要卡片（scope 级）
- [ ] 供应商状态卡片：每源类型/健康/env 钉定/文件形态（读视图，接线编辑属 provider-wiring-edit）

## 4. 常驻模式

- [x] `gui serve --daemon`：TTL 无限、空闲只锁不关
- [x] `gui install|uninstall`：launchd plist / systemd --user 单元生成、装载、卸载；`--port` 可选固定；install 输出安全摘要
- [x] 测试：单元文件生成快照、daemon 语义（空闲→locked 非 closed）（16 例 daemon.test.ts + cli 路由回归；真机 install→kill→KeepAlive 重拉→uninstall 全清验证）

## 5. 远程范围（打开远程网页管理）

- [ ] `mxenv remote add/list/remove`：登记 `{name, host, port?, transport:'ssh'}` 到 remotes.json（0600）
- [ ] 本地面板远程侧栏：点远程 → 起 `ssh -L` 隧道 → 经 SSH 执行远程 `mxenv gui attach --print-url` 取 URL → 浏览器打开**远程机自己的面板网页**；token 不落本机盘，隧道随会话拆
- [ ] guide：远程机管理节（远程 `gui install --port` + 本地登记 + 打开流程 + 值红线在远程路径的语义：远程动作远程审计）

## 6. 文档与收口

- [x] guide commands.md / security.md / ux-architecture.md / blog：常驻部分（gui install/uninstall/--daemon/--port、暴露面陈述、Wave B 状态、承诺清单勾选）
- [ ] guide 文档的远程节 + security.md 远程红线 + SKILL.md 端点边界（随组5/收口一并）
- [ ] 全门测试（core 148 / L2 189 / cli 62 / 根 13 → 更新后全绿）；openspec 归档准备
