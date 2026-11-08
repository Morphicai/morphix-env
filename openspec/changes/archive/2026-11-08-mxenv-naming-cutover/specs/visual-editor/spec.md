# Spec Delta

## MODIFIED Requirements

### Requirement: CLI 入口

`mxenv edit` SHALL 支持三种启动：裸命令（打开默认组合，含无 config 机器的隐式全局组合）、`--profile <name>`、`--source <name>`。无 `--profile`/`--source` 的裸调用 SHALL NOT 报错退出。

#### Scenario: 无 config 机器裸启动

- **WHEN** 在没有 `mxenv.config.json`/`~/.mxenv/config.json` 的机器上执行 `mxenv edit`
- **THEN** 编辑器启动并展示索引页（隐式全局组合）

### Requirement: 键名查看

每个文件型来源页（local、dotenvx）SHALL 列出该文件已有的全部键名。dotenvx 来源的键名列表 SHALL 无需解密值即可生成，且初始渲染 SHALL NOT 携带任何值。local 明文页保持整行 KEY=VALUE 可视编辑（值随行显示，本就是明文）。

#### Scenario: dotenvx 键名列表

- **WHEN** 打开一个 dotenvx 来源页
- **THEN** 页面列出该加密文件的全部键名，且无任何值被解密或显示

#### Scenario: 键名与 inspect 一致

- **WHEN** 对比该来源页键名列表与 `mxenv inspect` 中该来源的键名
- **THEN** 两者键名集合一致

### Requirement: 删除

dotenvx 与 os-keychain 来源 SHALL 支持删除单个键/条目，删除前 SHALL 有明确的破坏性确认。删除后该键 SHALL 不再出现在键名列表与运行时组合中。

#### Scenario: 确认后删除

- **WHEN** 用户对某键触发删除并在确认框中确认
- **THEN** 该键从来源中消失，键名列表与 `mxenv inspect` 不再包含它

#### Scenario: 取消删除

- **WHEN** 用户在确认框中取消
- **THEN** 来源无任何变化
