# Design

## Context

编辑器现状（0.10.1）：SSR React（`editor-ui`）+ Node loopback server（`editor.ts`），detached 子进程、一次性 token、15 分钟 TTL、保存后 250ms 关闭会话。local 页整行编辑；dotenvx 页仅单键盲写表单（`dotenvx set`）；keychain 页列 account 名 + 删除 + 写入（`keytar.findCredentials` 已取回密码但立即丢弃）；远程 provider 页只跳控制台。真实验收暴露的问题与动机见 proposal.md。既有教训：dotenvx 加载路径会被同名 parent-env 遮蔽文件值（0.10.1 migrate 验证缺陷根因）；editor-ui 客户端资产是生成物（`generated/clientAssets.ts`），漏重建会静默不进包。

## Goals / Non-Goals

**Goals:**
- 三目标（查看含值回显、修改/新增/删除、来源切换）在所有本地编辑面上行为一致。
- 值的传输面收敛为 provider ↔ 浏览器会话；CLI 输出、审计、错误信息零值。
- 会话支持多步维护操作（增/改/删/切源）且有明确生命周期终点。
- 无 config 机器（隐式全局组合）与 `--source`/`--profile` 三种启动下导航等价可用。

**Non-Goals:**
- 整页自动回显全部值、reveal 的自动隐藏计时器、复制到剪贴板按钮（后续可加）。
- 远程 provider（Infisical/Doppler）的本地编辑。
- 会话持久化、多用户/并发编辑、undo/变更历史、已删值恢复。
- 值回显的细粒度授权（token 即授权，模型不变）。

## Decisions

1. **值回显 = 逐键显式揭示，POST 表单驱动（SSR）**：揭示走 `POST action=reveal`，服务端读单值回填页面，单值驻留（揭示 B 即丢 A）。备选：客户端 fetch JSON + JS 显示（否决：值展示依赖客户端 JS，且偏离现有 SSR 表单模式）；整页解密回显（否决：违背单值驻留的最小暴露面）。
2. **dotenvx 读值用 `dotenvx get <KEY> -f <file> --overload` + hermetic env**：复用并导出 migrate 的 `verificationEnv()`（PATH 钉到当前 Node、其余白名单）；`--overload` 保证文件值胜过子进程环境——**含白名单自带的 HOME/PATH 等名字**（2.30 实证：无此旗标 `get HOME` 返回子进程 HOME）。所有调用钉 `cwd: dirname(file)`（key 材料随文件落位，migrate 同款理由）。按文件键模型选 env：有 `.env.keys`（或新/明文文件）→ `DOTENVX_NO_NATIVE` 文件模型；已加密但无 `.env.keys`（OS keychain 托管）→ 去掉旗标以可达托管键。`set`/`del` 同环境，值经 `--` 分隔传 argv（防 `-f` 形值被当选项，实证）；`set` 拒绝含 `$` 的值（展开语义无法忠实存储，同 migrate）。备选：引入 `@dotenvx/dotenvx` 库进程内解密（否决：新增依赖面，且 CLI 子进程模式与全仓现状一致）。
3. **dotenvx 键名列表 = 明文键名扫描**：dotenvx 文件格式 `KEY=encrypted:…`，键名本就明文，按行正则取名即可，零解密。备选：用 composition provenance 过滤（否决：组合层视角，看不到被覆盖的文件内键名，且耦合启动快照）。
4. **删除 = `dotenvx del <KEY> -f <file>`**（已实测命令与 `-f` 形态），确认框复用 keychain 页既有 AlertDialog 交互。
5. **会话模型改多步**：移除保存后自动关闭；新增显式"结束会话"（`POST action=close` → 应答后 `server.close()`）；TTL 不变。备选：保留保存即关、每操作重开（否决：与增/改/删/切源的多步验收直接冲突）。**BREAKING** 记入 CHANGELOG 与 skill 文档。
6. **导航**：root 路径恒显索引页；`--source` 启动时初始 URL 由子进程打印为 `/token/source/<name>`（`selectedSource` 已在 state 内，无需管道新字段）；页头来源切换器为纯链接行（SSR 免 JS），与多文件 FILE 下拉正交。备选：隐藏 back 链接保留钉死 root（否决：索引页继续不可达）。
7. **CLI 裸 `mx-env edit` 放行**：删除 `cmdEdit` 的强制 `--profile`/`--source` 前置校验，无参即默认组合（隐式 legacy 组合已由 `resolveComposition` 无参路径支持，inspect 同源）。
8. **审计扩展为可选 `action` + `via: 'editor'`**：`AuditEvent` 增 `action?: 'set' | 'delete' | 'reveal' | 'close'`（值无关，键名级），复用 `writeAudit`（best-effort、失败不影响操作）。备选：不记（否决：与治理承诺"全程审计"冲突）。
9. **UI 改动必过 `npm run build`**：`scripts/build-editor-ui.mjs` 重生成 `generated/clientAssets.ts`——它是 gitignored 中间物，随 tsup 打进 `dist/cli.js`（发版必经 build，无入库漂移面）；测试加一条构建产物冒烟（bundle 含新文案标记）。

## Risks / Trade-offs

- [值进入浏览器 DOM，暴露面大于纯名单] → 显式单键触发、单值驻留、`Cache-Control: no-store`（已有）、loopback + 一次性 token + TTL 不变；值永不落 CLI/审计。
- [`dotenvx get` 输出契约钉在 2.30（裸值 + 恰一个尾换行）] → 实证 + 集成测试钉住；解析只剥一个尾换行、不做 `KEY=` 前缀猜测（猜测会破坏以 `KEY=` 开头的值——二轮 review 实证否决了初版的"防御性剥离"）。遗留 `$` 值的揭示显示展开后的消费者可见形态（set 已拒绝新 `$` 值）。
- [写入值经 argv 传递，进程表瞬时可见] → dotenvx 无 stdin/env 通道（实证）；单用户本机毫秒级窗口，读路径零暴露；留待 provider 侧写入 API 收紧。
- [显式空值写入可清空密钥] → 拒绝空 `value` 写入（必须非空），UI 表单 `required` 双保险。
- [保存即关 → 多步会话是可见行为变更] → CHANGELOG 标 **BREAKING**、skill/README 同步、页脚明示结束方式与 TTL。
- [TTL 到期后页面变"死页"，POST 报连接错误] → 页脚明示 TTL（spec 要求）；前端倒计时不在本轮（Non-Goal）。
- [编辑器把值写进 audit 的实现失误] → 审计事件仅键名字段，测试断言事件 JSON 无值（含揭示值哨兵断言）。

## Migration Plan

无数据迁移。行为变更随 v0.11.0 发布：升级即得，降级（`npm i -g morphix-env@0.10.1`）即回滚（本轮无存储格式变化，`~/.mx-env/.env` 不动）。skill 文档经 `mx-env skill install --force` 同步。

## Open Questions

（无——值回显深度、会话模型、删除命令形态均已由用户决策或实测闭合。）
