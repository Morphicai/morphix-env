# Spec Delta

## Purpose

`mx-env edit` 一次性本地可视化编辑器：在 loopback 浏览器会话里查看、揭示、修改、新增、删除 provider 中的环境变量，并在来源/文件间导航；值只进入浏览器会话，永不进入 CLI 输出与审计。

## ADDED Requirements

### Requirement: 会话模型与生命周期

编辑器 SHALL 仅监听 127.0.0.1 随机端口，以一次性随机 token 路径防护，生命周期上限 15 分钟。保存/删除操作 SHALL NOT 结束会话（支持增、改、删、切源多步操作）；会话 SHALL 由显式"结束会话"动作或 TTL 到期结束。页面 SHALL 明示会话为一次性本地会话及其 TTL。

#### Scenario: 多步操作不中断

- **WHEN** 用户在一个会话内连续执行新增、修改、删除、切换来源
- **THEN** 每步保存后会话继续可用，直至显式结束或 TTL 到期

#### Scenario: 显式结束

- **WHEN** 用户触发"结束会话"
- **THEN** 服务端随即关闭，之后任何请求不再被响应

#### Scenario: TTL 到期

- **WHEN** 会话存在超过 15 分钟
- **THEN** 服务端自动关闭

### Requirement: 索引页与可达性

编辑器 SHALL 提供索引页：来源清单（名称、provider、状态、键数）与已解析键名→来源归属（仅键名，不含值）。无论以 `--source`、`--profile` 还是裸命令启动，索引页 SHALL 从任意页面经"All sources"链接可达；`--source` 启动时浏览器 SHALL 直接落在该来源的编辑页而非索引页。

#### Scenario: --source 模式回到索引

- **WHEN** 以 `--source <name>` 启动并在来源页点击"All sources"
- **THEN** 浏览器显示索引页（来源清单与键名归属）

#### Scenario: 索引页零值

- **WHEN** 索引页被渲染
- **THEN** 页面只含键名与来源归属，不含任何密钥值

### Requirement: CLI 入口

`mx-env edit` SHALL 支持三种启动：裸命令（打开默认组合，含无 config 机器的隐式全局组合）、`--profile <name>`、`--source <name>`。无 `--profile`/`--source` 的裸调用 SHALL NOT 报错退出。

#### Scenario: 无 config 机器裸启动

- **WHEN** 在没有 `mx-env.config.json`/`~/.mx-env/config.json` 的机器上执行 `mx-env edit`
- **THEN** 编辑器启动并展示索引页（隐式全局组合）

### Requirement: 键名查看

每个文件型来源页（local、dotenvx）SHALL 列出该文件已有的全部键名。dotenvx 来源的键名列表 SHALL 无需解密值即可生成，且初始渲染 SHALL NOT 携带任何值。local 明文页保持整行 KEY=VALUE 可视编辑（值随行显示，本就是明文）。

#### Scenario: dotenvx 键名列表

- **WHEN** 打开一个 dotenvx 来源页
- **THEN** 页面列出该加密文件的全部键名，且无任何值被解密或显示

#### Scenario: 键名与 inspect 一致

- **WHEN** 对比该来源页键名列表与 `mx-env inspect` 中该来源的键名
- **THEN** 两者键名集合一致

### Requirement: 逐键值回显

dotenvx 与 os-keychain 来源 SHALL 提供逐键显式值回显：用户对单个键触发"显示"后该值出现在页面上，并可再次触发"隐藏"。同一页面 SHALL 一次只驻留一个揭示值（揭示另一个键时先前揭示值消失）。揭示 SHALL NOT 通过整页自动回显发生。

#### Scenario: 显示与隐藏单个值

- **WHEN** 用户对某键点击"显示"，再点击"隐藏"
- **THEN** 该值先出现在页面上，随后从页面移除

#### Scenario: 单值驻留

- **WHEN** 用户已揭示键 A，再点击揭示键 B
- **THEN** 页面只显示键 B 的值，键 A 的值不再显示

#### Scenario: 揭示读取文件值

- **WHEN** 外层环境存在与文件同名的变量且值不同，用户揭示该键
- **THEN** 页面显示文件中存储的值，而非外层环境的同名值

### Requirement: 写入、修改与新增

dotenvx 来源 SHALL 支持单键写入（键存在即改写、不存在即新增），os-keychain 来源 SHALL 支持按 account 写入（存在即覆盖），local 来源保持整文件保存。写入 SHALL 只影响所提交的键（或所选文件），其余键保持原样。

#### Scenario: 改写单个键不影响其他键

- **WHEN** 对 dotenvx 文件改写键 K 的值
- **THEN** 文件中其他键的键名与值不变

#### Scenario: 新增键

- **WHEN** 提交一个不存在的键名与值
- **THEN** 该键被写入且可被运行时组合读取

### Requirement: 删除

dotenvx 与 os-keychain 来源 SHALL 支持删除单个键/条目，删除前 SHALL 有明确的破坏性确认。删除后该键 SHALL 不再出现在键名列表与运行时组合中。

#### Scenario: 确认后删除

- **WHEN** 用户对某键触发删除并在确认框中确认
- **THEN** 该键从来源中消失，键名列表与 `mx-env inspect` 不再包含它

#### Scenario: 取消删除

- **WHEN** 用户在确认框中取消
- **THEN** 来源无任何变化

### Requirement: 来源切换导航

编辑器每个页面 SHALL 提供来源切换入口，列出当前组合的全部来源并可直达各自编辑页；多文件来源保留文件内切换。来源切换 SHALL 无需经索引页中转。

#### Scenario: 页头切源

- **WHEN** 用户在任一来源页的页头选择另一来源
- **THEN** 浏览器直达该来源的编辑页

### Requirement: 值边界与编辑审计

密钥值 SHALL 仅在 provider 与浏览器会话之间传输：SHALL NOT 出现在 CLI stdout/stderr、审计记录、错误信息与索引页。编辑器的写入、删除、揭示操作 SHALL 追加值无关审计事件（时间、来源、键名、动作、结果），审计记录 SHALL NOT 含值。

#### Scenario: 审计有键名无值

- **WHEN** 用户通过编辑器改写键 K 的值并揭示键 J
- **THEN** 审计新增写入与揭示事件，含键名 K/J 与动作类型，不含任何值

#### Scenario: 错误信息零值

- **WHEN** 任一编辑操作失败（如 dotenvx 调用失败）
- **THEN** 返回的错误页与 CLI 侧输出不含所涉值
