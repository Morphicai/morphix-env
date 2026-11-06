# Tasks

## 1. 共享基础设施

- [x] 1.1 `src/audit.ts`：`AuditEvent` 增可选 `action` 字段、`via` 增 `'editor'`，类型检查过 `npm run build` 无 TS 错误
- [x] 1.2 `src/migrate.ts` 导出 `verificationEnv()`（或抽公共模块），editor 的 dotenvx 子进程调用统一复用；migrate 既有 25 个测试不回归

## 2. 服务端（src/editor.ts）

- [x] 2.1 root 路径恒显索引页（移除 `selectedSource` 钉死分支），`launchEditor` 子进程打印的初始 URL 在 `--source` 时带 `/source/<name>` 后缀；验证：单元测试断言 `homePath`/root 行为
- [x] 2.2 dotenvx 键名扫描（明文键名行正则，零解密）进 `localUiState` 的 `keyNames`；验证：加密夹具文件的键名列表与文件键名集一致
- [x] 2.3 dotenvx `reveal`（`action=reveal` → `dotenvx get <KEY> -f <file>` + hermetic env）与 `delete`（`action=delete` → `dotenvx del <KEY> -f <file>`）；验证：集成测试覆盖增→揭示→改→删 roundtrip，且同名 parent-env 遮蔽场景下揭示返回文件值
- [x] 2.4 保存/删除后不再关闭会话；新增 `action=close` 显式结束；验证：保存后第二个请求仍被服务，close 后连接被拒
- [x] 2.5 编辑器 set/delete/reveal 记值无关审计事件（`via: 'editor'` + `action` + 键名）；验证：审计 JSONL 含事件且断言不含值哨兵
- [x] 2.6 keychain 揭示（单值驻留，`findCredentials`/`getPassword` 取单值回填）；验证：keytar mock 测试覆盖揭示响应只含被揭示键的值

## 3. UI（src/editor-ui）

- [x] 3.1 `types.ts` 契约扩展（dotenvx: `keyNames` + `revealed`；keychain: `revealed`；saved: `sourceName`；各页共享来源导航数据）并修订值边界注释
- [x] 3.2 `App.tsx` DotenvxPage：Existing keys 列表（显示/隐藏、填入表单、删除+确认框）、单值驻留揭示、文案更新；KeychainPage 加显示/隐藏
- [x] 3.3 `App.tsx` 页头来源切换器（链接行）+ Saved/Error 页死链修复（继续编辑/结束会话/All sources）+ 页脚 TTL 文案
- [x] 3.4 `npm run build` 重生成 `generated/clientAssets.ts`（gitignored 中间物，随 tsup 打进 dist——本仓无生成物入库面）；验证：构建产物含新文案标记

## 4. CLI 与文档

- [x] 4.1 `cli.ts` 裸 `mx-env edit` 放行（无 `--profile`/`--source` 打开默认组合）；验证：CLI 测试覆盖裸调用启动成功
- [x] 4.2 skill 文档与 CLI help 中"保存后自动关闭"等表述更新（多步会话 + 显式结束 + TTL）；验证：文档与 spec 一致，`rg "自动关闭"` 无陈旧表述

## 5. 测试与校验

- [x] 5.1 新增 `test/editor.test.ts`（临时 HOME、真实 dotenvx 夹具）覆盖 spec 场景：索引可达、键名列表、揭示/单值驻留/文件值优先、增改删、会话不随保存关闭、审计零值；`npm test` 全绿
- [x] 5.2 `openspec validate --strict` 通过；全量 `npm test` + `npm run build` 绿；独立代码 review（findings 修复后复查）
- [x] 5.3 端到端人工验收：本机用新构建拉起编辑器，完成三目标验收用例（查看11键+揭示、增/删测试键、来源切换、All sources 可达）
