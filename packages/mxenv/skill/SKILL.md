---
name: mxenv
description: 通过 mxenv 为项目组装、检查、可视化编辑环境变量与密钥——多 provider（本地 .env / dotenvx 加密 / macOS 钥匙串 / Infisical / Doppler）、按 profile 组合、Agent 上下文零密钥。当用户提到环境变量、密钥、API key、credentials、.env、Infisical、Doppler、Keychain、"配置环境"、担心 secret 泄露，或需要 Agent/进程带着密钥运行而值不出现在对话里时使用。
user-invocable: true
argument-hint: "[install|show]"
---

# mxenv Agent 密钥工作流

mxenv 是密钥**组装层**，不是新的保险库：值永远留在 provider（本地文件、macOS 钥匙串、Infisical、Doppler、dotenvx）里。CLI 只把 profile 选定的 sources 组合成一次性子进程环境，并保证 inspect / audit / run 子进程输出全部脱敏。

包分层：`@morphixai/mxenv` = 运行面（项目装即完整可用：run/inspect/edit/migrate…）；`@morphixai/mxenv-cli` = 全局管理面（`shell-init` 等机器级能力）；`@morphixai/mxenv-core` = SDK 共享引擎（一般无需直接安装）。命令/bin 名仍是 `mxenv`（`mxenv run`、`mxenv inspect` 等不变）。

## 安全红线（任何情况下都不违反）

1. 绝不打印、记录、索取密钥值：不运行 `env` / `printenv` / `cat .env*` / `doppler secrets get --plain`，也不让用户把值粘贴进对话。
2. 只用 key 名验证状态：`mxenv inspect --profile <name>` 输出 key → source 归属与状态，不含值。
3. 增删改密钥一律走可视化编辑器：`mxenv edit`（可加 `--profile <name>` / `--source <name>` 收窄范围），用户在本地浏览器完成，值不经过 CLI 与对话。
4. 进程获得密钥的唯一方式是 `mxenv run`；子进程 stdout/stderr 中的注入值会被替换为 `[REDACTED]`。

## 推荐用法（收敛与轮换）

- **准入线**：只有"需要轮换的凭据"（token / API key / 密码）进 mxenv；配置类（镜像 URL、路径、开关）留在工具原生处（rc / npmrc）——配置进库会制造第二真相源，人和 Agent 都找不到"配在哪、怎么配的"。
- **消费处留引用**：支持 `${VAR}` 展开的文件（如 `~/.npmrc`）只留 `:_authToken=${NPM_TOKEN}` 这样的引用，值进库；换 token 时全部消费处零改动。
- **一家一凭据**：同一凭据不要在两个地方落值（例如 mxenv 与 npmrc 各存一份）——双家会在轮换后互相遮蔽。
- **轮换**：改值只走 `mxenv edit`（一处改、全局生效）；维护一份轮换台账（key → 存放处 → 周期 → 联动面），跨系统联动（如 GitHub secret）按台账逐项走。
- **运行时态不入库**：PATH / VOLTA_HOME 等由 shell 或工具链拼装的变量留 rc，进库反而会与工具链互相覆盖。

## 安装与检测

```bash
mxenv --version                          # 检测是否已安装
npm install -D @morphixai/mxenv          # 项目内安装运行面（推荐：run/inspect/edit/migrate 全在）
npx @morphixai/mxenv@latest inspect      # 免安装试用
npm install -g @morphixai/mxenv-cli      # 可选：机器级管理面（shell-init 等）
```

> ⚠️ **不要把 `@morphixai/mxenv` 与 `@morphixai/mxenv-cli` 同时全局安装**：两者都注册
> `mxenv`/`mx-env`/`morphix-env` bin，后装者会静默接管符号链接。项目用 devDep，
> 全局只装 cli；若确要全局装运行面，就不要再装 cli。

## 配置（mxenv.config.json）

配置文件**不含任何值**，只声明 source 接线与组合顺序。项目级放仓库根 `mxenv.config.json`；用户级 `~/.mxenv/config.json` 可选（全局基线，`--no-global` 可排除）。`~/.mxenv/.env` 是唯一自动发现的值文件（个人默认值）。

```jsonc
// 项目 mxenv.config.json — 全部 provider 示例
{
  "sources": {
    "local":     { "provider": "local", "files": [".env.local"], "optional": true, "override": true },
    "encrypted": { "provider": "dotenvx", "files": [".env.shared"] },
    "keychain":  { "provider": "os-keychain", "platform": "macos", "service": "com.example/myproject" },
    "infisical": { "provider": "infisical", "paths": ["/team/api"] },
    "doppler":   { "provider": "doppler", "project": "my-project", "config": "dev" },
    "plugin":    { "provider": "plugin", "plugin": "bitwarden", "keys": ["OPENAI_API_KEY"] }
  },
  "profiles": {
    "dev": { "sources": ["keychain", "infisical", "local"] },
    "ci":  { "sources": ["doppler"] }
  },
  "defaultProfile": "dev"
}
```

要点：

- profile 内 `sources` **从低到高**排列；同 key 冲突默认**报错**，靠后 source 显式 `"override": true` 才覆盖（防止两个环境的同名凭据静默错选）。
- `local`（明文 dotenv）**仅开发用**；长期存储用 dotenvx（加密文件）或 os-keychain，迁移走 `mxenv migrate`。
- provider 登录与引导留在 provider 侧（`infisical login`、`doppler login`、dotenvx 解密密钥引导），**不写进项目配置**。
- plugin source：PATH 上的 `mxenv-provider-<name> <KEY>` 把值写到 stdout（退出码 0）；插件自带登录，失败信息不含值。
- 固定基线顺序：`inherited process.env → ~/.mxenv/.env → 全局默认 profile → 项目 profile / legacy 配置 → -f 覆盖文件`。`~/.mxenv/.env` 恒在底层；项目/显式 profile 生效时**替代**全局默认 profile（要叠加全局源用 profile 的 `extends` 引入）。legacy 项目（`infisical` + `envFiles` 字段）无需改动即兼容。

## 命令速查

```bash
mxenv run --profile dev -- <command>    # 组合环境并执行（子进程输出脱敏）
mxenv run --no-global -- <command>      # 排除全局基线，可复现的项目-only 运行
mxenv run --serve -- <command>          # 值不进 env：子进程经 MXENV_ENDPOINT/MXENV_TOKEN 按需取值
mxenv fetch KEY                         # 在 --serve 子进程内取单个值（精确输出，无换行）
mxenv export [--profile dev]            # 输出可 eval 的 export KEY='value' 行（值只经 stdout 进入 eval）
mxenv render <tpl> <out>                # 把 ${VAR} 渲染进不支持插值的配置文件（0600，缺变量先告警）
mxenv inject <tpl> <out>                # 解析 mxenv://profile/KEY 引用（0600，MCP 配置入仓不落值）
mxenv generate --out public/__env.js    # 生成浏览器公开变量（NEXT_PUBLIC_/VITE_/EXPO_PUBLIC_ 属公开配置例外）
mxenv inspect [--profile dev]           # key 名 + source 归属 + 状态（无值）
mxenv edit [--profile dev | --source X] # 可视化编辑器（loopback + 15 分钟 TTL；查看/回显/增改删/切源，显式结束会话）
mxenv doc                               # 生成本项目的 key→source 工作流 Skill（.agents/skills/mxenv/）
mxenv audit [tail]                      # 值无关的本地审计事件
mxenv skill install [--target global|project|trellis|hermes] [--force]   # 安装本 Skill（hermes 配 --hermes-category 指定分类，默认 devops）
mxenv skill show                        # 查看各目标安装状态
mxenv migrate [--to dotenvx|keychain]   # local 明文迁加密存储（无 --to 为只读 plan；备份+等价验证+可回滚）
mxenv-cli shell-init [--write|--remove] # 为声明的命令生成 PATH shim（全局管理面，shims: ["node","pnpm"] 配置项）
```

**明文退场指引**：`local` provider（明文 dotenv 文件）定位是**仅开发用**——文件权限防不住同 uid 的 agent 进程。发现项目或全局在用明文源（`mxenv inspect` 里标 `[plaintext, dev-only]`），引导用户跑 `mxenv migrate` 看 plan，再 `--to dotenvx`（加密文件，跨机/CI 友好）或 `--to keychain`（macOS 钥匙串）。迁移有 0600 备份与值级等价验证，失败自动还原。legacy `.env.local` 不自动迁移——先引导声明为 source。

**shim 消费指引**：配置里声明过 `shims` 且执行过 `mxenv-cli shell-init` 的机器上，裸敲被声明命令（如 `pnpm dev`）等价于 `mxenv run -- pnpm dev`——你可以依赖它，无需加前缀。但 shim 是方便性不是隐藏：值仍在子进程 env。**需要值不进 env 的场景（高风险 agent 能力、不可信子进程树）必须显式用 `run --serve`**，不要依赖 shim。audit 里 `via: "shim"` 与 `"cli"` 可区分两种来路。

`export` / `render` / `inject` / `run` 均支持 `--dry-run`（只报 key/变量名，不出值）。值永不出现在 shell 历史里：`eval "$(mxenv export --profile dev)"` 才是 export 的消费方式。

## 进入一个新项目的标准流程

1. `mxenv inspect` — 看是否已有配置、哪些 key 已就绪；无配置时走 legacy `.env.local` / Infisical 兼容路径。
2. 项目密钥来源多而杂且无 `mxenv.config.json` → 引导用户创建：给出上面模板改 source 名与 provider 选择，**不填值**。
3. 缺值时 `mxenv edit` 打开本地编辑器让用户查看、填写、删除；macOS 浏览器自动打开，编辑器 URL 默认不打印（`--print-editor-url` 显式索取）。
4. `mxenv doc` — 生成**本项目**的 key→source 表（`.agents/skills/mxenv/SKILL.md`，0600），后续以它为准。
5. 运行：`mxenv run --profile <name> -- <command>`。

## 旧名迁移（0.12.x 过渡期）

旧名 `mx-env` / `morphix-env` 在 0.12.x 仍可运行（stderr 弃用提示）：旧 bin、`mx-env.config.json`、`~/.mx-env/`、`mx-env-provider-*` 读侧兼容，写侧一律落新名；keychain 旧 service 名（`mx-env:<source>`）由配置携带照读，**无需重迁移**；`mx-env://` 引用已切换 `mxenv://`（旧 scheme 报错提示改用新名）。`shell-init` 已迁全局管理面 `mxenv-cli`（旧名 bin 经 alias 转发到当值入口仍可用，0.13 摘除 alias 后须用新名）。见到旧配置/旧路径时引导用户跑 `mxenv migrate --home`（copy → 旧目录改名 `~/.mx-env.backup-<ts>` 留备份 → 值级等价验证，失败自动还原；成功后重接 shim PATH；全程值不落输出、幂等）并改用新名，不必手工搬运。

> 时序注：`~/.mx-env/` 读回落与 `migrate --home` 已随 mxenv-home-migration 落地；兼容窗持续到用户跑完 `migrate --home` 为止（其间写也落旧目录，`migrate --home` 后读写统一切到 `~/.mxenv/`）。

## 故障排查

| 症状 | 处理 |
|---|---|
| 冲突报错：同 key 来自两个 source | 确认哪个 source 应赢，给靠后的加 `"override": true` |
| `missing-optional, 0 keys` | `"optional": true` 的文件不存在，属预期；要强制存在就删掉 optional |
| Keychain 权限弹框 / 拒绝 | 首次访问会请求 service 授权；拒绝后重试或换 service 命名空间 |
| dotenvx 解密失败 | 解密密钥由 dotenvx 引导路径提供，不在本配置内 |
| `mxenv: command not found` | 项目内 `npm install -D @morphixai/mxenv`（或全局装它，但勿再装 cli）；或用 `npx @morphixai/mxenv@latest` 免安装 |
| `mxenv-cli: command not found` | shim 能力属全局管理面：`npm install -g @morphixai/mxenv-cli` |

---

本 Skill 与安装它的 CLI 同版本分发：`mxenv skill install` 覆盖安装即升级。模板内容 value-free；项目专属的 key 清单请以 `mxenv doc` 的输出为准。
