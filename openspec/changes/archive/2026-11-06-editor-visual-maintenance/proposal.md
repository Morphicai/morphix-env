# Proposal

## Why

真实 11 键全局收口后的可视化维护验收暴露编辑器能力缺口：加密源页面是一张"盲写"表单——看不到已有键名、无法删除、无法在来源间导航，`--source` 模式下连索引页都无路可达（back 链接死循环、隐式 legacy profile 显式打开被拒）。用户验收三目标（可查看已有环境变量、可修改/新增、可切换来源）当前仅"修改/新增"达标，且明确要求查看含**值回显**。

## What Changes

- **查看**：dotenvx 源页补已有键名列表（加密文件键名为明文，零解密扫描）；新增逐键显式值回显（点按显示/隐藏，单值驻留，不整页回显）；os-keychain 同步支持逐键揭示（findCredentials 已在内存，只改渲染边界）；local 明文页保持整行含值编辑不变。
- **修改/新增/删除**：dotenvx 补删除路径（`dotenvx del <KEY> -f <file>`，已实测确认命令与 `-f` 形态），带删除确认框（对齐 keychain 页既有交互）。
- **切换来源**：页头来源切换器（来源链接行，SSR 免 JS，与多文件 FILE 下拉正交）；**BREAKING** 会话模型从"保存后自动关闭"改为多步会话——保存不再关闭编辑器，由显式"结束会话"按钮 + 15 分钟 TTL 双控（增/改/删/切源需要连续操作）。
- 附带修复：root 路径恒显索引页（`--source` 时浏览器初始 URL 直达 `/source/<name>`，修复 ← All sources 死循环）；CLI 允许裸 `mx-env edit` 打开隐式组合（修复无 config 环境索引页不可达）；Saved/Error 页死链修复；页脚补 TTL 文案。
- 值边界声明修订（types.ts 注释与页面文案）："只有 local 页携带值"改为"值仅经显式揭示/编辑进入浏览器会话，永不进入 CLI 输出与审计"。
- 审计扩展：`AuditEvent` 增可选 `action` 字段、`via` 增 `'editor'`；编辑器的写入/删除/揭示记值无关审计事件（键名级）。
- 实现护栏：dotenvx 调用统一传 hermetic env（复用 migrate 的 `verificationEnv`，防同名 env 遮蔽文件值——0.10.1 教训）；editor-ui 改动必须重生成 `generated/clientAssets.ts`（生成物坑）。

## Capabilities

### New Capabilities
- `visual-editor`: `mx-env edit` 一次性本地可视化编辑器的完整契约——会话模型（loopback、一次性 token、显式结束 + TTL）、来源/文件导航、键名查看、逐键值回显、写入/删除、值与审计边界。

### Modified Capabilities
（无。`plaintext-retirement` 的 migrate 行为不变；审计事件仅增可选字段。）

## Impact

- `src/editor.ts`：root/初始 URL 路由、dotenvx 键名扫描与 `del`/`get` 调用（hermetic env）、会话不再随保存关闭、编辑审计。
- `src/editor-ui/types.ts` / `App.tsx` / `styles.css`：值回显交互、键名列表、删除确认、来源切换器、文案与死链修复。
- `src/cli.ts`：裸 `mx-env edit` 放行。
- `src/audit.ts`：`AuditEvent.action?`、`via: 'editor'`。
- `src/migrate.ts`：`verificationEnv` 导出复用。
- 测试：editor server 命令级测试（临时 HOME / 真实 dotenvx 夹具）、CLI 测试；`npm run build` 重生成客户端资产后随包分发。
- 文档：skill 速查与 README 中"保存后自动关闭"表述更新。
