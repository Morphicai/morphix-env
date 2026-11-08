# Design

## Context

值能力双件套中 `compose`（组合注入）已在 L1 实现；揭示（看值）逻辑现散落于编辑器后端 + editor-ui 交互层，安全纪律靠 UI 代码自觉。L0/L1 分层与"GUI/daemon 不碰文件不碰值"红线见 `docs/ux-architecture.md`（值安全边界节）；动机见 proposal.md。

现有揭示的两条既定语义必须保留（visual-editor spec 既有 scenario）：揭示取**来源存储值**（不是组合结果——外层环境同名值不覆盖）；同一页面单值驻留。

## Goals / Non-Goals

**Goals:**
- `mxenv-core` 暴露唯一揭示能力 `revealSingle`，纪律（授权校验、单值驻留、审计、暴露面）内建于能力。
- 编辑器值回显收敛为该能力的调用方（交互与存储值语义不变）。
- 为 Wave B 的 daemon/面板提供可直接消费的能力面（含授权上下文钩子）。

**Non-Goals:**
- daemon / 面板 / CLI `reveal` 命令本体（Wave B 自己的 change）。
- 解锁交互与锁定态 UI 流程（属常驻语境，Wave B 定）。
- 值缓存、批量揭示、跨键组合展示。

## Decisions

1. **揭示对象 = 来源存储值，不经组合覆盖链**。`revealSingle(key, { source?, subject })` 按键定位归属 provider 单键读取；`source` 缺省时取该键的唯一/获胜来源。理由：与编辑器既定语义一致（spec scenario"揭示读取文件值"）。暴露面收窄在**出口**（一次只交付一个值、错误/审计无值），而非加载量——底层 provider 仍按来源整载（与 compose 共用 loader，见风险表）；相对"拉全量组合再取键"少走覆盖链、少交付无关值。备选（复用 compose 后取键）被否：引入外层 env 覆盖语义。

2. **授权以显式上下文传入，能力只校验不管理会话**。`subject`（请求方标识）+ 由上层会话机制给出的授权标志构成上下文；默认无上下文即锁定态拒绝。理由：编辑器（15 分钟 token 会话）与未来 daemon（解锁窗口）的会话机制不同，能力层持中立校验点。备选（能力内建会话管理）被否：把 L3 的产品语义下沉进 L1。

3. **单值驻留 = 每上下文一个驻留槽，新揭示即清旧槽**。槽含值引用与短 TTL；释放=清引用 + TTL 过期。**如实标注风险**：JS 字符串不可原地擦除，"清除"是释放引用交还 GC，非物理覆写——这与现状（编辑器值经内存渲染）等同，不新增暴露；更强保证（TypedArray 覆写）留待有真实威胁模型时再议。

4. **审计并轨既有 journal，新增值无关 `reveal` 事件**（时间/键名/subject/结果）。编辑器既有"揭示"审计并入此事件，不再自记第二条（visual-editor delta 已定）。

5. **能力不缓存值**：每次揭示即读 provider；驻留槽仅服务"当前展示"这一份短生命周期引用。

## Risks / Trade-offs

- [JS 值字符串无法物理擦除] → 释放引用 + 短驻留 TTL；审计/日志/错误永不落值做兜底红线测试。
- [调用方拿到值后自行持久化] → 能力文档与 review 红线注明"值仅供展示、调用方不得持久化"；能力 API 不提供批量/流式出口。
- [编辑器改造引入回归] → visual-editor 既有 9 条 requirement 的测试全量护航；改造仅换读值路径，交互层零改动。
- [双读值路径漂移（compose 读 vs revealSingle 读）] → 两者共用底层 provider 单键读取原语，仅出口语义不同（注入 vs 展示）。

## Migration Plan

无数据/配置迁移。发版：`mxenv-core` minor（新增能力 API）、`mxenv` patch/minor（编辑器改调）。回滚 = revert 单提交，无状态残留。发布前跑 `pnpm -r test` 全门（parity 教训，见记忆 mxenv-parseargs-parity-full-gate）。

## Open Questions

无——锁定态/解锁的交互细节随 Wave B 的 change 定，不影响本 change 的 spec 与任务切分。
