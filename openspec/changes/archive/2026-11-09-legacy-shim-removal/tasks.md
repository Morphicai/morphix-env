# Tasks

## 1. 垫片摘除（加载链与安装面）

- [x] 1.1 三包 `package.json` `bin` 字段收窄为新名（去掉 `mx-env`/`morphix-env` 垫片 bin；mxenv-cli 的 `mxenv-cli`/`shell-init` 面不动），验证 `npm pack --dry-run` / manifest 检查 bin 面只剩新名
- [x] 1.2 摘除 `mx-env.config.json` 读回落：配置只读 `mxenv.config.json`；检测到旧文件存在且新名缺失时输出改名指引（非静默空配置、不自动改名），验证单测覆盖"旧文件不参与解析且给指引"与"双配置并存只认新名"两个 scenario
- [x] 1.3 摘除 `mx-env-provider-<plugin>` 插件名回退：解析只认 `mxenv-provider-<plugin>`，验证单测覆盖"仅装旧插件名时解析失败并报告缺失的新名"
- [x] 1.4 旧名调用与旧 shim 的失效出口收口：`mxenv migrate` 及相关报错话术指向 `mxenv-cli shell-init` 再生成（shim 双 marker 识别/剥离逻辑不动），验证报错文本含再生成指引

## 2. 测试面收口

- [x] 2.1 垫片语义用例逐类处置（naming-cutover 记录约 65 处）：删除旧名正向等价断言，保留/新写反向断言钉住"旧 bin 名不存在、旧配置不参与、旧插件名不回退、旧 shim 失效"（即 spec 移除后 scenarios 的测试面），验证 `pnpm -r test` 全绿且反向断言在场
- [x] 2.2 运行 `pnpm -r test` 全门与三包 typecheck，不以单包测试代替（发版门纪律，见记忆 mxenv-parseargs-parity-full-gate；本 change 不改 parseArgs flag，parity 面无改动仍随全门复核）

## 3. 文档与公告

- [x] 3.1 README / packages/mxenv/README / SKILL.md 的"0.13.x 摘除"措辞改为已执行口径，并保留"升级后重跑 `mxenv-cli shell-init` 再生成存量 shim"的公告指引，验证文档互校无"仍可用/仍回落"的过时表述
- [x] 3.2 文档 `rg` 旧名清零 gate：`rg 'mx-env|morphix-env'` 只剩豁免类（CHANGELOG 历史条目、openspec 档案、keychain `mx-env:<source>` service 名语义、`~/.mx-env/` 目录读回落语义、测试反向断言 fixture），验证残留逐类可枚举、无越界
- [x] 3.3 CHANGELOG 0.13.1 条目：到期移除公告（三类垫片）+ 存量 shim 再生成公告 + 旧 bin 链接残留手动移除提示

## 4. 收口

- [x] 4.1 `openspec validate --strict` 通过后发版 0.13.1（三包 lockstep）并两机对齐，验证 npm 落地与 `skill show` 同版（**发布须用户逐项放行**）
