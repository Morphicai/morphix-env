# Proposal

## Why

值揭示（看某个密钥的值）目前只存在于编辑器 UI 的内部逻辑里，安全纪律（逐键解锁、单值驻留、审计）散落在前端交互代码中，没有统一强制点。Wave B 的常驻 daemon + 面板要提供"随时看值"，而 `docs/ux-architecture.md` 的红线是 **GUI/daemon 不碰文件、不碰值，值能力（compose / revealSingle）唯一实现在 L1**——不先立这个唯一实现，面板的"显示值"要么各自读文件破边界，要么根本做不了。因此本 change 是 Wave B（daemon + 面板）的前置入口。

## What Changes

- `mxenv-core`（L1）新增值能力 **`revealSingle(keyName)`**：单键揭示的唯一实现（与既有 `compose` 构成值能力双件套）。
- 安全纪律**内建于能力本身**而非调用方：逐键解锁（默认锁定态不可调）、单值驻留（揭示新键即清除旧驻留值）、全量审计（记 key 名 / 时间 / 请求方，**永不记值**）、窄暴露（一次一值、短暂驻留）。
- 现有编辑器的值回显改造为调用该能力；交互语义不变（显示 / 隐藏切换、同一页面单值驻留）。
- 为 Wave B 的 daemon API 与常驻面板"显示值"预留唯一合法入口（本 change **不含** daemon / 面板本体）。
- 无 BREAKING：外部行为不变，core 新增 API 属 minor 级。

## Capabilities

### New Capabilities
- `value-reveal`: 单键值揭示能力——解锁 / 驻留 / 审计 / 锁定与暴露面纪律，唯一实现于 L1，供编辑器、CLI 与未来的 daemon/面板共用。

### Modified Capabilities
- `visual-editor`: 值回显 requirement 增加"揭示操作 SHALL 经 value-reveal 唯一实现执行"的约束（交互语义不变，仅收敛实现路径与审计口径）。

## Impact

- **packages/mxenv-core**：新增 `revealSingle` 能力 API 与审计事件类型（值无关）。
- **packages/mxenv**：编辑器后端值回显改调 core 能力；editor-ui 前端交互不变。
- **测试**：新增红线测试——值绝不落审计 / 日志 / stdout / 错误信息；单值驻留与解锁时序。
- **无**配置迁移、无 schema 变化、无消费方升级要求。
