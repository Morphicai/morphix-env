# Design

## 决策

### D1 项目注册表（"已经托管的"从哪来）

mxenv 至今无机器级项目清单——组合是 cwd 驱动的无状态行为。全局面板的第一性问题就是枚举，答案 = 显式注册表 `~/.mxenv/projects.json`（0600）：`{ name, path, addedAt, lastSeenAt }[]`。

- **登记时机**：项目级 `run`/`edit` 首次成功组合后幂等登记（name=basename(path)，路径冲突加后缀），`panel add` 显式增删，`MXENV_NO_PROJECT_REGISTRY=1` 全局关闭。
- **不扫盘**：全盘找 `.mxenv/config.json` 不可接受（慢、权限、意外）；登记而非发现，诚实反映"被 mxenv 管过"。
- **lastSeenAt** 每次组合刷新（写节流：同会话 60s 内不重复写）。

### D2 UI 宿主与资产归属

面板 UI 由 **L3 宿主服务**承载：`GET /{token}/` 校验 token-in-path 后返回无会话状态的 HTML，通用 React bundle 在浏览器运行时从当前 path 取 token，后续 API 带 Bearer + `x-mxenv-panel: 1`；token 不写入 HTML、bundle 或持久化存储。资产 = mxenv-cli 自有 `src/panel-ui/`（React + shadcn + Tailwind + esbuild，组件从 editor-ui 拷贝同源；构建产物经 `generated/clientAssets.ts` 打进 dist）。HTML 引用内容寻址 JS/CSS，JS 带 SHA-256 SRI，CSP 由响应头发送，资源请求重新校验 token + hash。**不破产品包零依赖纪律**：L3 不 import L2，React 等仅为构建期 devDependency，发布物自包含。

`mxenv edit` 本 change 保持现状（一次性、项目态、深链接直达单源编辑页）。**终态（用户 2026-11-18 定向）：编辑器并入管理面板**——`edit` 退化为"打开面板的项目范围编辑"快捷入口，编辑成为面板的一个形态而非平行工具；合并排在面板 v1（读+值写回）稳定后，属 `provider-wiring-edit` change 的收口项。

### D3 项目读：进程内 baseDir 切换，不 spawn

归档 change 钉过"项目态写操作经宿主=spawn 项目本地 CLI"，本设计**收窄该纪律到写侧历史形态**：读（collectEntries + L1 组合）在宿主进程内以 `baseDir` 参数化完成——L1 本就是路径参数化的，spawn 引入版本漂移与跨进程审计断链，收益为零。写回走 D4 提取的 L1 动作，同样进程内。原纪律的实质（L3 不 import L2 产品包）保持不变。

### D4 写回：编辑器动作核心下沉 L1

editor.ts 的白名单 set/delete（含 dotenvx 嗅探、文件序、审计、`savedUiState`）已是正确语义，但长在 L2 UI 服务器里。提取 `edit-actions.ts` 到 L1（输入：config/source/key/value/action + baseDir；输出：文件变更 + 审计事件），L2 editor 与 L3 host 双消费。面板写端点门禁 = 解锁窗口（与 reveal 同一窗口、同墙钟判定）+ `x-mxenv-panel` 消费者边界 + 逐动作审计（`via: 'host'`）。

**全局基线写**：`~/.mxenv/.env` 是 dotenvx 加密文件——set/delete 走同一动作核（dotenvx provider 重加密），`__mx_global_dotenv` 就是它的源名。

### D5 常驻：单元文件 + TTL 无限，锁定语义不动

`mxenv gui install` 生成 launchd `dev.mxenv.panel.plist`（macOS，`RunAtLoad+KeepAlive`）/ systemd --user `mxenv-panel.service`（Linux）；`gui serve --daemon` 进程侧 TTL 无限。**安全模型不随生命周期放宽**：面板仍默认锁定，unlock 窗口照旧（4h TTL 语义只属于一次性会话）；空闲自动锁从"关会话"变为"仅锁定"（常驻不能自杀——单元 KeepAlive 会拉起，改为锁语义才自洽）。`gui close` 保留（临时停），`uninstall` 移除单元即真停。

端口：默认随机 + runtime.json 发现（现有模型，安全默认）；`--port` 显式固定仅服务远程/自动化场景，文档钉"固定端口=更大的本机暴露面，仅在理解后使用"。

### D6 远程：打开远程机的网页，经 gui 管理（用户 2026-11-18 定向）

远程主机管理的形态（用户定向）：**本地面板列出远程 → 点开即起 `ssh -L` 隧道 → 浏览器打开远程机自己的面板网页**——同一套 UI 与宿主 API 跑在远程机上，管理动作全部在远程面板内完成，本地不做数据聚合/中转（值永不离开远程机的 loopback → 隧道 → 本地浏览器的这条直线）。

`~/.mxenv/remotes.json`（0600）只存 `{name, host, port=7654?, transport:'ssh'}`（远程侧 `gui install --port` 固定端口）。打开远程时本地经 SSH 执行远程 `mxenv gui attach --print-url` 取一次性 URL——token 不落 remotes.json（每会话短生命周期，与本地宿主同纪律），隧道进程随面板会话结束而拆。

不做：云 relay、mTLS、面板直连公网、本地面板内嵌远程数据。值红线在远程路径不变（names-only 默认、unlock 窗口、审计落远程本机 `~/.mxenv/audit/`——远程动作远程记账，本机不中转值）。

### D7 外部供应商：names-only 枚举 + 逐键 reveal（用户 2026-11-18 定向）

`/keys` 不再按 provider 白名单跳过 Infisical/Doppler。所有来源统一经 L1 `loadSource` 加载，响应只投影 `key/source/provider/inherited/fileIndex/status`，不返回值；单源失败不阻塞其他来源，失败状态仍由 `/wiring` 供应商卡片呈现。远程读取可能产生上游延迟，这是用户显式打开该 scope 时的明确成本，不在后台自动轮询。

远程 provider 的 reveal 复用既有 `revealSingle`：同一 Bearer + 面板边界头 + unlock 窗口，单值驻留、`no-store`、90 秒 UI 自动隐藏、值无关审计。这里只开放**读值**，不开放远程 set/delete；UI 继续用 provider 元数据隐藏远程写按钮，继承的全局源在项目 scope 中同样禁止写回。

## 风险

- **面板 bundle 供应链**：静态资产由构建产出，npm 发布前 CI 校验 bundle 哈希与源一致（任务组 5）。
- **注册表膨胀**：CI/临时目录大量 run 会灌入一次性路径——登记仅限有 `.mxenv/` 或 config 层存在的目录，且 `panel remove` + `--prune`（清除 path 已不存在的条目）兜底。
- **常驻 = 常在暴露面**：loopback 绑定不变；面板锁默认；unlock 需人工。风险陈述进 guide security 节，`install` 输出一次安全摘要。
