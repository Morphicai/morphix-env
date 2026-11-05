# Tasks

## 1. 配置契约与递归防护（先于 shim 生成落地）

- [x] 1.1 `src/shims.ts` 新建：`RESERVED_SHIM_NAMES` 常量（全部 CLI 命令名 + `mx-env`/`morphix-env`/`__mx_editor`）；`validateShimList(list)`（非字符串/空串/`/`/`\`/空白/保留名/大小写不敏感重复 → 错误清单）；`resolveShimCommands(layers)` 全局∪项目、大小写不敏感去重；`shimsDir()`；单测正反覆盖
- [x] 1.2 `src/config.ts`：`MxEnvConfig` 增加 `shims?: string[]`；`validateConfig` 对 `shims` 用 1.1 的校验但**不硬失败**——返回问题列表供调用方降级（组合路径 stderr 警告并忽略该字段，shell-init 硬失败）；parity 测试：cli.ts 命令 dispatch 表与 RESERVED_SHIM_NAMES 一致（防未来新增命令漂移）
- [x] 1.3 `src/cli.ts` cmdRun：`resolveComposition` **之前**净化基底 PATH（filter-all 移除所有解析为 shimsDir 的条目；realpath 两侧归一；darwin 大小写不敏感；同时剥离 `MXENV_SHIM` 标记），组合期 provider spawn 与最终子进程共享净化结果；`runChild` 保留一次剥离作双保险
- [x] 1.4 e2e：声明 `node` shim + 一个内部调用 `node` 的假 plugin provider，经 shim 触发 run，断言无递归、组合完成、plugin 内 `node` 解析到真身（固化评审 finding 1）

## 2. shell-init 命令

- [x] 2.1 `src/shims.ts`：`writeShims(commands)` 生成带守卫的 POSIX 脚本（design 决策 7 的完整脚本体，0755，文件头标记），移除不再声明的本工具 shim（按标记识别），幂等；单测：两次执行产物逐字节一致、清单缩减收敛、手工文件不动
- [x] 2.2 `src/shims.ts`：rc 标记块读写（`# >>> mx-env shims >>>`/`<<<`），`--write` 幂等写、`--remove` 幂等删；默认模式打印 PATH 行与推断 rc 路径（$SHELL → ~/.zshrc / ~/.bashrc）；单测覆盖块替换/移除/块外内容不动
- [x] 2.3 `src/cli.ts`：`Args` 增加 `write`/`remove` 字段并接入 parser；`shell-init` 对未识别的 flag 报错（防静默 no-op）；接 `shell-init [--write|--remove]` 命令 + help 文案；逐命令 PATH 解析校验（解析结果 ≠ shim 路径 → stderr 警告不阻断）；发现保留名手工残留文件时警告
- [x] 2.4 临时 HOME 端到端：`shell-init`（默认打印）→ `--write`（rc 真有标记块）→ 重复 `--write`（无漂移）→ `--remove`（块与 shim 消失）→ 再 `--remove`（幂等）

## 3. 审计维度与组合路径降级

- [x] 3.1 `src/audit.ts`：audit 记录增加 `via` 维度（`"shim"` | `"cli"`），保持 value-free；回归断言 audit 不含值
- [x] 3.2 `src/cli.ts` 组合路径（run/export/render/generate）：`shims` 字段非法时 stderr 警告并忽略、注入照常；`shell-init` 路径硬失败；两侧各有测试

## 4. 端到端验证

- [x] 4.1 临时 HOME + 临时 PATH 的 e2e：声明 `node` shim → 裸调 shim → 断言子进程拿到组合值、子进程内 `command -v node` 解析到真身、退出码透传（命令 exit 3 → shim exit 3）、audit 含 `via: shim` 且不含值
- [x] 4.2 负路径 e2e：未声明命令无 shim；非法条目组合路径仅警告；mx-env 不在 PATH 时 shim 报错含"shell-init --remove"指引且 exit 127
- [x] 4.3 全量测试绿（`pnpm test`），连续 3 次无 flake

## 5. 文档与收口

- [x] 5.1 README：新增 "Terminal shims" 章节（清单配置、init/--write/--remove、递归防护语义、决策 4 的项目语义声明、边界声明：方便性≠对 agent 隐藏，高风险走 `run --serve`、macOS/Linux only、"不要手工往 shim 目录放文件"）
- [x] 5.2 skill/SKILL.md：补 shim 消费指引（agent 何时可依赖 shim、何时必须显式 run --serve）
- [x] 5.3 CHANGELOG 0.9.0 草稿条目；`openspec validate terminal-command-shims --strict` 通过
- [ ] 5.4 独立 code review（正确性 + 生产就绪双视角）→ 修复门禁项 → PR → 合并后按 0.8.0 同流程发版（npm publish 前向用户确认）
