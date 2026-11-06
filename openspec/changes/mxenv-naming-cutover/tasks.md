# Tasks

## 1. 命名全切与垫片（前置：mxenv-package-split 挪完源码）

- [ ] 1.1 `refs.ts` 命名切换：解析/生成只认 `mxenv://`，遇 `mx-env://` 报错提示改用新 scheme，验证 refs 测试覆盖新旧两向用例
- [ ] 1.2 bin 切 `mxenv`，`mx-env`/`morphix-env` alias bin 转发 + stderr 弃用提示一次，验证旧名执行行为等价且 export stdout 纯净（提示仅 stderr）。**bin 归属钉住**（package-split 4.x review N1）：全局 `mxenv` bin 落 `mxenv-cli`（L3，含 shell-init），项目 devDep bin 落 `mxenv`（L2）；L2 warnInvalidShims 等 4 处 `mx-env shell-init` 指引文案随 1.7 改名后自愈的前提=全局 bin 在 L3——若最终 bin 落 L2 则 shell-init 指引仍断链
- [ ] 1.3 配置/插件双读与写落新名：`mxenv.config.json` 优先 + 旧名回落、插件 `mxenv-provider-<plugin>` 优先 + 旧名回落；写只落新名（旧文件来源写前备份改名），验证双配置/双插件两组用例
- [ ] 1.4 keychain 默认 service 改 `mxenv:<source名>`，旧 service 名配置携带照读，验证新旧两向用例
- [ ] 1.5 shim 清单位置随全局目录新名改 `~/.mxenv/`（shim 生成/剥离代码本体归 mxenv-package-split 4.1；全局目录双读回落归 mxenv-home-migration），验证位置改名后 shim 测试（临时 HOME）绿
- [x] 1.6 文档先行改名（2026-11-06，用户指令"先更新文档"）：README/SKILL.md/docs 目标态改名完成，LICENSE/SECURITY.md 建立；迁移映射表/现状对照/CHANGELOG 历史有意保留旧名，rg 复核通过
- [ ] 1.7 代码/生成物/分发 skill 改名（含 `package.json` description、`.github/workflows/release.yml` Release 标题、`scripts/copy-skill.mjs` 日志前缀）+ CHANGELOG 0.12.0 条目，验证 `rg 'mx-env|morphix-env'` 仅剩垫片代码与 CHANGELOG 历史。注意：`openspec/specs/plaintext-retirement|visual-editor/spec.md` 的 Purpose 行已按 schema 要求先行直改（existing capability Purpose 只能直改 specs/，delta 内 Purpose 被忽略），requirement 正文旧名待本 change apply 时随 delta 合并切换——同文件新旧混排是预期中间态，以本 gate 的 rg 清零收口

## 2. 开源基础件

- [x] 2.1 补 LICENSE（MIT 全文，版权人 Morphicai）与 SECURITY.md（GitHub Private Vulnerability Reporting + 支持版本表）——已随文档先行完成（2026-11-06）；GitHub 渲染识别留发布时复核

## 3. 验证 gate

- [ ] 3.1 全量验证：pnpm -r test/typecheck/build 绿 + `openspec validate --strict mxenv-naming-cutover` 通过 + `rg 'mx-env|morphix-env'` 旧名清零（垫片代码与 CHANGELOG 历史除外）+ 文档-架构-代码三方互校（README/SKILL/ux-architecture 与实现、design/spec 逐条对照，偏差修文档或修实现并记录）
- [ ] 3.2 双视角 review（release-review-checklist）+ token 出域审计，验证无 secret 进 diff/日志

## 4. 发布与本机迁移（前置：mxenv-package-split、mxenv-home-migration 完成）

- [ ] 4.1 发布（**须用户逐项放行**）：npm 发 `mxenv-core`/`mxenv`/`mxenv-cli` 0.12.0 → `morphix-env@0.12.0` 收尾转发 → `npm deprecate morphix-env` → GitHub Release 迁移表；包名 `mxenv-cli` 在此最终确认（发布前与用户核对）；pack 前各包目录拷入 LICENSE/README 并补 repository/author 元数据（npm pack 不带根文件）+ ESM 具名导出可见性冒烟（cjs-module-lexer 对 tsup 产物）；**发布顺序护栏**：`mxenv-core` 必须最先发布（发布前解除 `private`）并确认 registry 可解析后再发 `mxenv`/`mxenv-cli`/`morphix-env`，否则安装即 MODULE_NOT_FOUND（morphix-env 依赖 `mxenv-core`，core 未发布时直接 publish 会发坏包）——发布脚本加 prepublish 守卫（core 未发布即拒绝），或在本任务按序人工执行并核验
- [ ] 4.2 本机迁移：装新包、`migrate --home`、zshrc eval 行改 `mxenv export`、skill 重装，验证本机 `rg 'mx-env' ~/.zshrc` 清零且终端注入正常
- [ ] 4.3 跨仓同步：Trellis change `mx-env-secret-source` 文案改 `mxenv://` + SDK 消费改 `mxenv-core`，验证 Trellis 仓 `rg 'mx-env://' openspec` 清零（仅历史归档除外）
