# Design

## 决策

### D1 项目注册表（"已经托管的"从哪来）

mxenv 至今无机器级项目清单——组合是 cwd 驱动的无状态行为。全局面板的第一性问题就是枚举，答案 = 显式注册表 `~/.mxenv/projects.json`（0600）：`{ name, path, addedAt, lastSeenAt }[]`。

- **登记时机**：项目级 `run`/`edit` 首次成功组合后幂等登记（name=basename(path)，路径冲突加后缀），`panel add` 显式增删，`MXENV_NO_PROJECT_REGISTRY=1` 全局关闭。
- **不扫盘**：全盘找 `.mxenv/config.json` 不可接受（慢、权限、意外）；登记而非发现，诚实反映"被 mxenv 管过"。
- **lastSeenAt** 每次组合刷新（写节流：同会话 60s 内不重复写）。

### D2 UI 宿主与资产归属

面板 UI 由 **L3 宿主服务**（`GET /{token}/` token-in-path 一次性换 HTML，bundle 内嵌 token 转 Bearer，后续 API 带 `x-mxenv-panel: 1`）。资产 = mxenv-cli 自有 `panel-ui/`（构建期由 scripts 打包，技术栈与 L2 editor-ui 同源——React+shadcn 复用组件拷贝，非运行时依赖）。**不破产品包零依赖纪律**：L3 不 import L2，静态资产不是依赖。

`mxenv edit` 保持现状（一次性、项目态、深链接直达单源编辑页）——编辑器是"改这一处"，面板是"看全局+管一切"，两形态并存不合并。

### D3 项目读：进程内 baseDir 切换，不 spawn

归档 change 钉过"项目态写操作经宿主=spawn 项目本地 CLI"，本设计**收窄该纪律到写侧历史形态**：读（collectEntries + L1 组合）在宿主进程内以 `baseDir` 参数化完成——L1 本就是路径参数化的，spawn 引入版本漂移与跨进程审计断链，收益为零。写回走 D4 提取的 L1 动作，同样进程内。原纪律的实质（L3 不 import L2 产品包）保持不变。

### D4 写回：编辑器动作核心下沉 L1

editor.ts 的白名单 set/delete（含 dotenvx 嗅探、文件序、审计、`savedUiState`）已是正确语义，但长在 L2 UI 服务器里。提取 `edit-actions.ts` 到 L1（输入：config/source/key/value/action + baseDir；输出：文件变更 + 审计事件），L2 editor 与 L3 host 双消费。面板写端点门禁 = 解锁窗口（与 reveal 同一窗口、同墙钟判定）+ `x-mxenv-panel` 消费者边界 + 逐动作审计（`via: 'host'`）。

**全局基线写**：`~/.mxenv/.env` 是 dotenvx 加密文件——set/delete 走同一动作核（dotenvx provider 重加密），`__mx_global_dotenv` 就是它的源名。

### D5 常驻：单元文件 + TTL 无限，锁定语义不动

`mxenv gui install` 生成 launchd `dev.mxenv.panel.plist`（macOS，`RunAtLoad+KeepAlive`）/ systemd --user `mxenv-panel.service`（Linux）；`gui serve --daemon` 进程侧 TTL 无限。**安全模型不随生命周期放宽**：面板仍默认锁定，unlock 窗口照旧（4h TTL 语义只属于一次性会话）；空闲自动锁从"关会话"变为"仅锁定"（常驻不能自杀——单元 KeepAlive 会拉起，改为锁语义才自洽）。`gui close` 保留（临时停），`uninstall` 移除单元即真停。

端口：默认随机 + runtime.json 发现（现有模型，安全默认）；`--port` 显式固定仅服务远程/自动化场景，文档钉"固定端口=更大的本机暴露面，仅在理解后使用"。

### D6 远程：契约先行，SSH 隧道零新密码学

远程主机管理的最小诚实形态：**同一套宿主 API，经 SSH 端口转发到达**。`~/.mxenv/remotes.json`（0600）登记 `{name, host, port=7654?, transport:'ssh'}`（远程侧 `gui install --port` 固定端口 + 隧道 `ssh -L 17654:127.0.0.1:<port>`）。面板远程范围的 token 获取 = 首次连接触发远程 `mxenv gui attach --print-url`（经 SSH 执行）——token 不落 remotes.json（每会话短生命周期，与本地宿主同纪律）。

不做：云 relay、mTLS、面板直连公网。值红线在远程路径不变（names-only 默认、unlock 窗口、审计落远程本机 `~/.mxenv/audit/`——远程动作远程记账，本机不中转值）。

## 风险

- **面板 bundle 供应链**：静态资产由构建产出，npm 发布前 CI 校验 bundle 哈希与源一致（任务组 5）。
- **注册表膨胀**：CI/临时目录大量 run 会灌入一次性路径——登记仅限有 `.mxenv/` 或 config 层存在的目录，且 `panel remove` + `--prune`（清除 path 已不存在的条目）兜底。
- **常驻 = 常在暴露面**：loopback 绑定不变；面板锁默认；unlock 需人工。风险陈述进 guide security 节，`install` 输出一次安全摘要。
