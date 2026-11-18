# Tasks

## 1. L1 能力（mxenv-core）

- [x] `projects.json` 注册表：读/幂等登记（name 冲突后缀）/ lastSeenAt 节流写 / remove / prune / `MXENV_NO_PROJECT_REGISTRY` 旁路；0600（mxenv-core/src/registry.ts；8 例 registry.test.ts）
- [x] run/edit 首次成功组合登记埋点（仅当目录存在 .mxenv/ 或 mxenv.config.json；cli.ts registerCurrentProject；L2 3 例集成测试）
- [ ] `remotes.json`：登记/删除/列出；0600
- [x] `edit-actions` 提取：从 L2 editor.ts 抽白名单 set/delete 动作核（dotenvx 嗅探、文件序、审计事件构造）；L2 `edit` 改为消费之（行为零变化，既有编辑器测试护航）
- [x] 测试：edit-actions 与编辑器行为等价（注册表幂等/节流/prune 已随 registry.test.ts 落地）

## 2. L3 宿主 API 扩展（mxenv-cli）

- [x] `GET /scopes`：全局 + projects.json 清单（remotes.json 清单随 P4 落地，当前显式返回空远程清单）
- [x] `GET /wiring?scope=`：源接线与供应商状态（provider 类型/健康/Infisical env 钉定/dotenvx 文件形态/keychain service+keys；names/status only，无接线编辑——见 provider-wiring-edit change）
- [x] 外部供应商 names-only：`/keys` 覆盖 Infisical/Doppler 等 provider，返回 provider/source/inherited，单源故障隔离，响应无值
- [x] 外部供应商 reveal：复用 `revealSingle` + unlock + scope + no-store；90 秒自动隐藏、无值审计、远程 set/delete 继续拒绝
- [x] `/keys?scope=`：`global` / `project:<name>`（core 统一解析 profile/legacy，baseDir 进程内切换）；无效 scope 404；reveal 同 scope 隔离与审计归属
- [x] `POST /set` `/delete`：unlock 窗口门禁 + `x-mxenv-panel` 边界 + edit-actions 执行 + 审计 `via:'host'`；全局基线与项目 local/dotenvx 文件
- [x] 静态 UI 服务：`GET /{token}/` token-in-path 校验 → panel bundle；token 失效即 404（与 API 同纪律）
- [x] 测试：scopes/keys 隔离、写门禁（锁定态拒绝/边界头缺失拒绝）、审计事件、UI 路径认证
- [x] `GET /snapshot?scope=`：keys + wiring 共用一次来源加载，有界并发、异步 dotenvx；`/keys`/`/wiring` 保持兼容投影
- [x] 测试：snapshot 无值与 provider 元数据、故障隔离、真实 Edge scope 切换 Query 缓存（60 秒内不重复请求）
- [x] Agent 输入请求：`gui request KEY [--scope] [--reason]` 深链（键名/说明无值、URL 消费即清）；面板解锁后预填表单 + reason 展示；CLI 键名/scope 校验（L3 集成测试 + Edge 全流程：锁定提示→解锁预填→取消→URL 清参）
- [x] reveal 行内展示：值显示在所属键行内（复制/手动隐藏、90 秒自动隐藏），移除顶部值横幅（Edge 实证）

## 3. panel-ui（mxenv-cli 自有资产）

- [x] 脚手架：React + shadcn + Tailwind + esbuild（组件从 editor-ui 拷贝同源）；`src/panel-ui/` 构建为内容寻址 JS/CSS + SRI，经 generated clientAssets 打进 dist，发布物自包含
- [x] 范围侧栏：全局 / 项目（from /scopes）已落地；远程（from /scopes，隧道提示）随 P4
- [x] 键表：names-only、来源/Provider 列、组合顺序标注；解锁按钮 → 窗口内 reveal（单键、点击复制）
- [x] set/delete 对话框（值输入 type=password、二次确认、审计提示文案）
- [ ] doctor 摘要卡片（scope 级）
- [x] 供应商状态卡片：每源类型/健康/env 钉定/文件形态（读视图，接线编辑属 provider-wiring-edit）

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
- [x] 全门测试：core 166 / L2 192 / cli 81 / 根 13 全绿；真实 daemon 的全局 dotenvx 与项目 local 合成键写删、token 404、写边界复验通过；本机 Edge 验证 global/project 切换、unlock、合成写确认后取消、lock，JS/CSS 200 且 console/page error 为 0
- [ ] openspec 归档准备（待正式 React UI、doctor 摘要与远程范围完成）
