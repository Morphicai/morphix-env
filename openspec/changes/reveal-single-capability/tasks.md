# Tasks

## 1. L1 值能力（mxenv-core）

- [x] 1.1 实现 provider 单键读取原语（按 key 定位归属 provider 读**来源存储值**，不经组合覆盖链），并验证单测覆盖"外层环境同名值不同仍返回存储值"场景
- [x] 1.2 实现 `revealSingle(key, { source?, subject })` 能力：默认锁定态拒绝、授权上下文校验、每上下文单值驻留槽（新揭示清旧槽 + 短 TTL 释放），并验证单测覆盖"锁定态拒绝"与"驻留互斥"两个 spec scenario
- [x] 1.3 新增值无关 `reveal` 审计事件（时间/键名/subject/结果），并验证单测断言成功、拒绝、失败三路都记账且事件文本不含值
- [x] 1.4 增加暴露面红线测试：揭示出错（键不存在/解密失败）时错误信息不含值；能力路径 stdout/stderr 无值输出

## 2. 编辑器收敛（mxenv）

- [x] 2.1 编辑器后端值回显改调 `revealSingle`（编辑器 token 会话即授权上下文），验证 `visual-editor` 既有全部测试通过（交互与"揭示读取文件值"语义不变）
- [x] 2.2 揭示审计并轨 `reveal` 事件、编辑器不再自记第二条揭示记录，验证审计断言"单次揭示恰一条揭示事件"

## 3. 收口

- [x] 3.1 运行 `pnpm -r test` 全门与两包 typecheck，验证全部通过（不以单包测试代替）
- [x] 3.2 文档口径同步：SKILL.md/README 的值能力表述补 revealSingle（compose/revealSingle 双件套），`docs/ux-architecture.md` 状态行注记本 change 落地，验证文档互校无矛盾表述
- [ ] 3.3 发版 `mxenv-core`（minor）+ `mxenv`（跟随）并两机对齐，验证 npm 落地与 `skill show` 同版（**发布须用户逐项放行**）
