# 多项目架构下，环境变量管理的最佳实践

> 从 `.env` 文件满天飞，到一个命令统一管理 —— 我在 MorphixAI 开发中踩过的坑和最终方案

---

## 背景

先交代一下上下文。

我在做一个叫 MorphixAI 的项目 —— 一个 AI 驱动的个人工作台。它的核心思路是把你散落在 GitHub、Jira、Notion、邮件、日历等平台的工作数据聚合起来，让 AI 帮你理解上下文、管理任务、执行操作。

这个项目的技术栈比较多样：

| 子项目 | 技术栈 | 用途 |
|--------|--------|------|
| morphicai-api | Express + TypeScript | 后端 API |
| morphicai-web | Next.js 15 + React 19 | Web 前端 |
| morphicai-app-shell | Vite + Ionic + Capacitor | 跨平台 App Shell |
| morphicai-native | React Native + Expo | iOS/Android 客户端 |
| openclaw-morphixai | Node.js | MCP Server（开源） |
| morphixai-code | Node.js | CLI 工具（开源） |

6 个子项目，3 种前端框架，部署在 Zeabur 上。项目推进节奏比较快，如果在环境变量这种「基础设施」问题上反复踩坑，那真的太浪费时间了。

这篇文章想分享的就是：在这种多项目架构下，我是怎么一步步理顺环境变量管理的，以及最终沉淀出的方案和工具。

![MorphixAI 整体架构图](https://gw-tk.tanka.ai/npc/v2/file/89ed129b-69e7-44c2-9b63-241de08c4f9c)

---

## 阶段一：`.env` 文件管理

最早的做法和大多数项目一样 —— 每个项目根目录放一个 `.env` 文件，里面写满各种密钥和配置。

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJhbGciOi...
OPENAI_API_KEY=sk-...
```

`.env` 加到 `.gitignore` 里，然后写一个 `.env.example` 提交到 git。

![多项目 .env 文件散落问题](https://gw-tk.tanka.ai/npc/v2/file/6f070e6a-92ad-4eb9-bf11-eb4c4b69f6dc)

项目早期是够用的。但随着子项目越来越多，问题集中暴露了：

**多项目重复配置**。比如 `SUPABASE_URL`、`SUPABASE_KEY`，6 个项目都要用，值完全一样。但每个项目各自维护一份 `.env`，改一个值得跑到 6 个目录里挨个改，漏一个就是线上问题。

**密钥安全无法保障**。项目里有 OpenAI API Key、Supabase Service Key 这些直接关联费用的密钥。OpenAI 的 key 是实打实按 token 计费的，泄露了就是真金白银的损失。`.env` 文件虽然加了 `.gitignore`，但它就是一个明文文件，躺在本地磁盘上。如果项目需要和其他开发者协作，你没办法做到精细的权限控制。

---

## 阶段二：引入 Infisical

意识到 `.env` 文件管理不住之后，我们引入了 Infisical。

### Infisical 是什么

**Infisical 是一个开源的密钥管理平台**，你可以理解为专门给开发者设计的密钥保险箱 —— 一个地方存所有密钥，所有环境、所有项目从这里统一拉取。

<!-- 建议配图：Infisical Dashboard 截图，展示多环境、多 folder 的管理界面 -->

核心能力：

| 能力 | 说明 |
|------|------|
| 多环境管理 | dev / staging / prod 各一套，互不干扰 |
| 项目 + Folder 隔离 | 一个项目下可以按 `/ai`、`/frontend` 等路径分组 |
| 两种认证方式 | 本地用 CLI 登录（`infisical login`），CI/Docker 用 Machine Identity |
| SDK 集成 | Node.js / Python / Go SDK，代码里直接拉取 |
| CLI 工具 | `infisical run -- npm start` 一行搞定注入 |
| 权限控制 | 按人、按角色、按环境控制访问 |

市面上做密钥管理的工具不少，比如 HashiCorp Vault。但 Vault 是企业级方案，部署和维护成本都高。Infisical 卡在一个很好的位置 —— 比 `.env` 文件规范，比 Vault 轻量，有开源版可以自部署，也有云服务直接用。

### 我们怎么用的

本地开发通过 Infisical CLI 拉取密钥：

```bash
infisical login          # 一次性登录
infisical run --env=dev --path=/ai -- next dev   # 拉取密钥并启动
```

生产部署走 GitHub Actions。在 CI 构建阶段，先通过 Infisical CLI 动态拉取密钥，生成 `.env` 文件，再执行 Docker 构建：

```yaml
# GitHub Actions 构建流程
steps:
  - name: 从 Infisical 拉取密钥
    run: infisical export --env=prod --path=/ai --format=dotenv > .env
  - name: 构建 Docker 镜像
    run: docker build .
```

<!-- 配图：GitHub Actions 构建日志截图，展示 infisical export 和 docker build 的步骤 -->

这解决了两个核心问题：密钥有了统一的来源（single source of truth），以及密钥的访问可以通过权限控制来管理。

关于协作安全，这里说一下实际情况。Infisical 的权限控制是管理层面的 —— 你可以控制谁能在 Infisical 管理界面上看到哪些密钥。但只要项目跑起来了，环境变量已经注入到 `process.env` 里，技术上是可以读取的。所以 Infisical 的价值不是「绝对防泄露」，而是**降低密钥暴露面** —— 密钥不再以明文文件的形式存在，不需要在聊天工具里传来传去，访问权限可以集中管控和审计，需要的时候随时收回。

### 还有什么不够顺畅

- **`.env` 文件构建到 Docker 镜像中有安全隐患**。CI 里先 `infisical export` 生成 `.env`，再 `docker build`，密钥就被烘焙进了镜像。任何能拉到这个镜像的人都能看到里面的密钥
- **Docker 镜像里装 Infisical CLI 麻烦**。Alpine 镜像装 CLI 有二进制依赖问题，镜像体积也会增大
- **本地覆盖不方便**。`infisical run` 注入远程密钥后，想把某个 URL 临时指向 `localhost` 调试，没有优雅的覆盖方式

---

## 阶段三：迁移到 Zeabur，催生 morphix-env

转折点是把部署从 GitHub Actions 迁移到了 Zeabur。

**Zeabur** 是一个国内团队做的 PaaS 部署平台，类似 Vercel / Railway。它提供了一个很方便的功能 —— 自动识别项目中的 Dockerfile，从 GitHub 仓库拉代码直接构建和部署。不需要自己写 CI 流程，推代码就自动部署。

<!-- 配图：Zeabur 部署界面截图，展示自动识别 Dockerfile 构建的流程 -->

但这也意味着，我们没有办法在 Docker 构建之前插入额外的步骤了。之前在 GitHub Actions 里「先 `infisical export` 拉密钥生成 `.env`，再 `docker build`」的方式，在 Zeabur 上行不通 —— 它直接构建你的 Dockerfile，没有地方执行预处理脚本。

而且回过头想，之前的方式其实也有问题：**先拉取密钥生成 `.env` 文件，再构建到 Docker 镜像里，这本身就不安全**。密钥被烘焙进了镜像，任何能拉到镜像的人都能看到。

这里需要区分两类环境变量：

- **前端公开变量**（如 `SUPABASE_URL`、`SUPABASE_ANON_KEY`）—— 这些本来就会出现在浏览器端的 JS bundle 里，编译进产物没有安全问题
- **服务端密钥**（如 `OPENAI_API_KEY`、`SUPABASE_SERVICE_KEY`）—— 这些绝对不能固化到镜像里，只应该在运行时使用

所以我们真正需要的是：

1. **不依赖特定的 CI/CD 平台** —— 不管是 GitHub Actions 还是 Zeabur，都能用
2. **密钥按需动态拉取** —— 构建时需要就在构建时拉，运行时需要就在运行时拉，但不提前生成 `.env` 文件、不固化到镜像里
3. **不需要在 Docker 镜像里装 Infisical CLI** —— 用轻量的 Node.js SDK 就行
4. **本地开发能方便地覆盖** —— `.env.local` 优先

于是就有了 morphix-env。

---

## morphix-env：最终方案

### 核心设计

```bash
morphix-env run -- next dev
```

这一行命令背后做了五件事：

```
1. 读取配置文件 mx-env.config.json
2. 从 Infisical 按需拉取密钥（自动选择 SDK 或 CLI）
3. 如果配置了 envPrefix，自动给变量加前缀
4. 加载 .env.local 覆盖（本地开发自定义）
5. 启动子命令，继承完整的 process.env
```

不管是 `npm run dev`（本地开发）、`npm run build`（Docker 构建阶段）、还是 `npm start`（生产运行），都走同一个命令。密钥在命令执行的那一刻从 Infisical 拉取，不需要提前准备任何文件。

![morphix-env 工作流程](https://gw-tk.tanka.ai/npc/v2/file/06731782-d850-4a43-b167-abaf1640f437)

### 设计决策一：变量优先级

```
┌──────────────────────────────────────────┐
│  .env.local                   ← 最高优先  │
│  开发者的本地覆盖，永远优先               │
├──────────────────────────────────────────┤
│  Infisical secrets             ← 中优先   │
│  远程拉取，不覆盖已有值                   │
├──────────────────────────────────────────┤
│  process.env                   ← 最低优先  │
│  Docker ENV、CI 变量、shell exports       │
└──────────────────────────────────────────┘
```

这意味着：
- 远程密钥管理是底座，保证所有项目用同一套配置
- 本地想改个 API 地址调试？改 `.env.local` 就行，不影响远程配置
- Docker/CI 中已有的 process.env 作为最后兜底

### 设计决策二：自动识别认证方式

```
有 INFISICAL_CLIENT_ID 环境变量？
  → 用 SDK（Machine Identity）—— Docker / 部署平台场景
没有？
  → 本地装了 infisical CLI？
    → 用 CLI（用户登录态）—— 本地开发
  → 也没有？
    → 跳过 Infisical，只用本地文件
```

开发者不需要关心当前是用 SDK 还是 CLI —— 工具自动判断。本地开发跑一次 `infisical login`，之后 `pnpm dev` 就自动拉取。Docker 里设几个环境变量就行，不需要装 CLI 二进制。

### 设计决策三：envPrefix

Infisical 里存的是通用的变量名（如 `SUPABASE_URL`），但不同前端框架要求不同前缀。在配置中声明 `envPrefix`，拉取时自动转换：

```json
{
  "infisical": {
    "paths": ["/frontend"],
    "envPrefix": "VITE_"
  }
}
```

Infisical 里只维护一份变量，不同项目按需配置前缀：

| 项目 | envPrefix | SUPABASE_URL 变为 |
|------|-----------|-------------------|
| morphicai-api | 不配置 | `SUPABASE_URL`（原样） |
| morphicai-web | `NEXT_PUBLIC_` | `NEXT_PUBLIC_SUPABASE_URL` |
| morphicai-app-shell | `VITE_` | `VITE_SUPABASE_URL` |

---

## 实际使用

### 配置文件

```json
// mx-env.config.json（提交到 git，不含密钥）
{
  "infisical": {
    "paths": ["/frontend"],
    "envPrefix": "VITE_"
  },
  "envFiles": [".env.local"]
}
```

### package.json

```json
{
  "scripts": {
    "dev": "morphix-env run --env dev -- vite",
    "build": "morphix-env run -- vite build",
    "start": "morphix-env run -- node server/index.js"
  }
}
```

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

# 运行阶段
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev
CMD ["npm", "start"]
```

有一点需要说明：morphix-env 要连接 Infisical 拉取密钥，本身还是需要几个认证信息。这几个变量需要在部署平台（如 Zeabur）上配置为环境变量：

| 变量 | 说明 |
|------|------|
| `INFISICAL_CLIENT_ID` | Machine Identity 的 ID |
| `INFISICAL_CLIENT_SECRET` | Machine Identity 的密钥 |
| `INFISICAL_PROJECT_ID` | Infisical 项目 ID |
| `DEPLOY_ENV` | 环境标识（dev / prod） |

这些是「拉取密钥的钥匙」，数量很少且固定，只需要在平台上配一次，永久生效。剩下的几十上百个业务密钥全部从 Infisical 动态拉取，不需要在部署平台上逐个配置。后续新增环境变量，只需要去 Infisical 管理平台上加一条，所有项目下次启动时自动生效，不需要改任何代码或部署配置。

<!-- 配图：Zeabur 环境变量配置界面截图，只有 INFISICAL_CLIENT_ID 等 4 个变量 -->

注意 `morphix-env` 必须在 `dependencies`（不是 `devDependencies`），因为 `start` 脚本在运行阶段也需要它。

---

## 适用场景

什么时候你该考虑类似的方案？

- 项目有 **2 个以上环境**（dev/staging/prod）
- 项目中有**关联费用的密钥**（OpenAI Key、云服务 Key 等），需要管控访问
- 在用 **Docker 部署**或 **PaaS 平台**（环境变量传递链路变长）
- 有 **多个子项目**共享同一批密钥
- 前后端项目需要**不同的变量前缀**

如果以上中了 3 个，值得花半天时间理一理。

---

## 总结

环境变量管理不是什么高深的技术问题，但它确实是一个「不解决就一直烦你」的工程问题。

我的经验是：

1. **密钥必须有一个 single source of truth** —— 我们选了 Infisical，你也可以选其他方案，关键是「一处修改，处处生效」
2. **本地开发必须能覆盖** —— 远程配置是底座，但开发者需要灵活性
3. **密钥按需拉取，而不是提前生成文件** —— 减少中间环节，降低泄露面
4. **工具能跑在所有环境** —— 本地、CI、Docker、PaaS，一套配置搞定

morphix-env 就是按这些原则写的，目前在 MorphixAI 的 6 个子项目中都在用。核心代码 300 行左右，但确实帮我省了不少时间。

开源在 npm 上：

```bash
npm install morphix-env
```

GitHub: [github.com/Morphicai/morphix-env](https://github.com/Morphicai/morphix-env)

如果你也在多项目架构下被环境变量折磨过，欢迎试试。有问题可以直接提 issue。

---

*如果觉得有帮助，点个赞或者收藏一下。后续我会继续分享 MorphixAI 开发过程中的工程实践，包括多端 SDK 通信、AI Agent 架构设计等内容。*
