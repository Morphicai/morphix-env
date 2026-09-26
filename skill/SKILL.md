---
name: morphix-env
description: 通过 morphix-env（mx-env）为项目组装、检查、可视化编辑环境变量与密钥——多 provider（本地 .env / dotenvx 加密 / macOS 钥匙串 / Infisical / Doppler）、按 profile 组合、Agent 上下文零密钥。当用户提到环境变量、密钥、API key、credentials、.env、Infisical、Doppler、Keychain、"配置环境"、担心 secret 泄露，或需要 Agent/进程带着密钥运行而值不出现在对话里时使用。
user-invocable: true
argument-hint: "[install|show]"
---

# morphix-env（mx-env）Agent 密钥工作流

morphix-env 是密钥**组装层**，不是新的保险库：值永远留在 provider（本地文件、macOS 钥匙串、Infisical、Doppler、dotenvx）里。CLI 只把 profile 选定的 sources 组合成一次性子进程环境，并保证 inspect / audit / run 子进程输出全部脱敏。

## 安全红线（任何情况下都不违反）

1. 绝不打印、记录、索取密钥值：不运行 `env` / `printenv` / `cat .env*` / `doppler secrets get --plain`，也不让用户把值粘贴进对话。
2. 只用 key 名验证状态：`mx-env inspect --profile <name>` 输出 key → source 归属与状态，不含值。
3. 增删改密钥一律走可视化编辑器：`mx-env edit --profile <name>`（或 `--source <name>`），用户在本地浏览器完成，值不经过 CLI 与对话。
4. 进程获得密钥的唯一方式是 `mx-env run`；子进程 stdout/stderr 中的注入值会被替换为 `[REDACTED]`。

## 安装与检测

```bash
mx-env --version                 # 检测是否已安装
npm install -g morphix-env       # 安装（mx-env 与 morphix-env 两个 bin 等价）
npx morphix-env@latest inspect   # 免安装试用
```

## 配置（mx-env.config.json）

配置文件**不含任何值**，只声明 source 接线与组合顺序。项目级放仓库根 `mx-env.config.json`；用户级 `~/.mx-env/config.json` 可选（全局基线，`--no-global` 可排除）。`~/.mx-env/.env` 是唯一自动发现的值文件（个人默认值）。

```jsonc
// 项目 mx-env.config.json — 五种 provider 全示例
{
  "sources": {
    "local":     { "provider": "local", "files": [".env.local"], "optional": true, "override": true },
    "encrypted": { "provider": "dotenvx", "files": [".env.shared"] },
    "keychain":  { "provider": "os-keychain", "platform": "macos", "service": "com.example/myproject" },
    "infisical": { "provider": "infisical", "paths": ["/team/api"] },
    "doppler":   { "provider": "doppler", "project": "my-project", "config": "dev" }
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
- provider 登录与引导留在 provider 侧（`infisical login`、`doppler login`、dotenvx 解密密钥引导），**不写进项目配置**。
- 固定基线顺序：`inherited process.env → ~/.mx-env/.env → 全局默认 profile → 项目 profile / legacy 配置 → -f 覆盖文件`。legacy 项目（`infisical` + `envFiles` 字段）无需改动即兼容。

## 命令速查

```bash
mx-env run --profile dev -- <command>    # 组合环境并执行（子进程输出脱敏）
mx-env run --no-global -- <command>      # 排除全局基线，可复现的项目-only 运行
mx-env generate --out public/__env.js    # 生成浏览器公开变量（NEXT_PUBLIC_/VITE_/EXPO_PUBLIC_ 属公开配置例外）
mx-env inspect [--profile dev]           # key 名 + source 归属 + 状态（无值）
mx-env edit --profile dev | --source X   # 一次性可视化编辑器（loopback + 15 分钟 TTL，保存后自动关闭）
mx-env doc                               # 生成本项目的 key→source 工作流 Skill（.agents/skills/morphix-env/）
mx-env audit [tail]                      # 值无关的本地审计事件
mx-env skill install [--target global|project|trellis] [--force]   # 安装本 Skill
mx-env skill show                        # 查看各目标安装状态
```

## 进入一个新项目的标准流程

1. `mx-env inspect` — 看是否已有配置、哪些 key 已就绪；无配置时走 legacy `.env.local` / Infisical 兼容路径。
2. 项目密钥来源多而杂且无 `mx-env.config.json` → 引导用户创建：给出上面模板改 source 名与 provider 选择，**不填值**。
3. 缺值时 `mx-env edit --profile <name>` 打开本地编辑器让用户填写；macOS 浏览器自动打开，编辑器 URL 默认不打印（`--print-editor-url` 显式索取）。
4. `mx-env doc` — 生成**本项目**的 key→source 表（`.agents/skills/morphix-env/SKILL.md`，0600），后续以它为准。
5. 运行：`mx-env run --profile <name> -- <command>`。

## 故障排查

| 症状 | 处理 |
|---|---|
| 冲突报错：同 key 来自两个 source | 确认哪个 source 应赢，给靠后的加 `"override": true` |
| `missing-optional, 0 keys` | `"optional": true` 的文件不存在，属预期；要强制存在就删掉 optional |
| Keychain 权限弹框 / 拒绝 | 首次访问会请求 service 授权；拒绝后重试或换 service 命名空间 |
| dotenvx 解密失败 | 解密密钥由 dotenvx 引导路径提供，不在本配置内 |
| `mx-env: command not found` | `npm install -g morphix-env`，或用 `npx morphix-env@latest` 免安装 |

---

本 Skill 与安装它的 CLI 同版本分发：`mx-env skill install` 覆盖安装即升级。模板内容 value-free；项目专属的 key 清单请以 `mx-env doc` 的输出为准。
