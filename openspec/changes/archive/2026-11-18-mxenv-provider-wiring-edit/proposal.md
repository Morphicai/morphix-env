# Proposal

## Why

全局面板的三域梳理（2026-11-18 用户定向：统一管理与控制密钥供应商、管理全局、管理使用 mxenv 的项目）把**供应商升为一等管理对象**。读视图（类型/健康/env 钉定/文件形态）已入 `global-panel` change；但**接线编辑**——增删改源、改 Infisical env 钉定、改文件序——影响的是该机器/项目所有后续 `run` 的组合结果，爆炸半径远大于改一个值，须独立 change 单独设计门禁与回滚。同时 `mxenv edit`（一次性编辑器）按用户定向终态**并入管理面板**：编辑成为面板的项目范围形态，`edit` 命令退化为快捷入口。

## What Changes

- **L1 `config-actions`**：接线编辑动作核（add/remove/update source、Infisical env 钉定、profile 调整），原子写 `mxenv.config.json`（写前生成 0600 备份 `mxenv.config.json.bak`、失败回滚）、变更前后 diff 摘要、审计事件构造。
- **宿主写端点扩展**：`POST /wiring-preview` 只读预览 + `POST /wiring-write` 提交——门禁 = 解锁窗口 + `x-mxenv-panel` 边界头 + 显式项目 scope + **二次确认**（请求须携带用户在 UI 中看到的 diff 摘要指纹，防盲改）+ 逐动作审计 `via: 'host'`（含脱敏 before/after 摘要，不含值）。
- **panel-ui 接线编辑器**：供应商卡片进入编辑态（受解锁窗口约束）、变更预览 diff、二次确认对话框、审计提示文案。
- **doctor 单源测试面板化**：某源"测试连接"动作（read-only compose 该源并展示结果），复用 doctor 判定。
- **`mxenv edit` 并入面板**：编辑器 UI 并为面板的项目范围编辑形态；`edit` 命令保留，行为 = 打开面板对应项目范围（深链接）；一次性编辑器服务随迁移完成后移除。
- **legacy 接线迁移动作**（面板内）：项目 `mxenv.config.json` 的 flat `infisical`/`envFiles` → 同文件现代 `sources` + `profiles` 的迁移向导（等价预览 + 确认），与 CLI 组合判定同源。

## Capabilities

### New Capabilities

- `provider-wiring-edit`: 接线编辑动作核（原子写/备份/回滚/diff）、宿主写端点与二次确认门禁、接线编辑 UI、doctor 单源测试、edit 并入面板契约。

## Impact

- **mxenv-core**（minor）: `config-actions`（含 legacy 迁移向导判定复用）。
- **mxenv-cli**（minor）: `/wiring-write` 端点与门禁；panel-ui 编辑态。
- **mxenv**（major-adjacent）: `edit` 行为切换（打开面板深链接）；一次性编辑器移除排在面板编辑形态验收后。
- **风险**: 接线误改 = 后续所有 run 组合变化——二次确认 + 备份回滚 + 审计三重兜底；不做"批量接线编辑"（一次一源）。

## 非目标

- 远程 provider 值写回（2026-11-19 用户裁决不做：远程值在供应商自己的管理后台编辑，面板对远程源只读）。
- 全局配置（`~/.mxenv/config.json`）的面板编辑（先项目侧；全局侧接线变更更低频，CLI 兜底）。
- Windows 自启/移动端。
