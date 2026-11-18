# Tasks

## 1. L1 能力（mxenv-core）

- [ ] `projects.json` 注册表：读/幂等登记（name 冲突后缀）/ lastSeenAt 节流写 / remove / prune / `MXENV_NO_PROJECT_REGISTRY` 旁路；0600
- [ ] `remotes.json`：登记/删除/列出；0600
- [ ] `edit-actions` 提取：从 L2 editor.ts 抽白名单 set/delete 动作核（dotenvx 嗅探、文件序、审计事件构造）；L2 `edit` 改为消费之（行为零变化，既有编辑器测试护航）
- [ ] run/edit 首次成功组合登记埋点（仅当目录存在 .mxenv/ 或 config 层）
- [ ] 测试：注册表幂等/节流/prune、edit-actions 与编辑器行为等价

## 2. L3 宿主 API 扩展（mxenv-cli）

- [ ] `GET /scopes`：全局 + projects.json 清单 + remotes.json 清单
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

## 4. 常驻模式

- [ ] `gui serve --daemon`：TTL 无限、空闲只锁不关
- [ ] `gui install|uninstall`：launchd plist / systemd --user 单元生成、装载、卸载；`--port` 可选固定；install 输出安全摘要
- [ ] 测试：单元文件生成快照、daemon 语义（空闲→locked 非 closed）

## 5. 远程范围（打开远程网页管理）

- [ ] `mxenv remote add/list/remove`：登记 `{name, host, port?, transport:'ssh'}` 到 remotes.json（0600）
- [ ] 本地面板远程侧栏：点远程 → 起 `ssh -L` 隧道 → 经 SSH 执行远程 `mxenv gui attach --print-url` 取 URL → 浏览器打开**远程机自己的面板网页**；token 不落本机盘，隧道随会话拆
- [ ] guide：远程机管理节（远程 `gui install --port` + 本地登记 + 打开流程 + 值红线在远程路径的语义：远程动作远程审计）

## 6. 文档与收口

- [ ] guide commands.md：gui 子命令全量（install/uninstall/--daemon/--port）、panel add/remove
- [ ] security.md：常驻暴露面陈述、远程管理红线
- [ ] ux-architecture.md：Wave B 状态更新（B2 面板落地、常驻落地、远程契约先行）
- [ ] blog 承诺清单核对（面板常驻 → 已交付）；SKILL.md 红线补写端点边界
- [ ] 全门测试（core 146 / L2 189 / cli 45 / 根 13 → 更新后全绿）；openspec 归档准备
