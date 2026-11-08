# Spec Delta

## MODIFIED Requirements

### Requirement: 逐键值回显

dotenvx 与 os-keychain 来源 SHALL 提供逐键显式值回显：用户对单个键触发"显示"后该值出现在页面上，并可再次触发"隐藏"。同一页面 SHALL 一次只驻留一个揭示值（揭示另一个键时先前揭示值消失）。揭示 SHALL NOT 通过整页自动回显发生。揭示操作 SHALL 经 value-reveal 能力（唯一实现）执行并落入其统一审计口径；编辑器会话（一次性 token 上下文）即该能力的有效授权上下文。

#### Scenario: 显示与隐藏单个值

- **WHEN** 用户对某键点击"显示"，再点击"隐藏"
- **THEN** 该值先出现在页面上，随后从页面移除

#### Scenario: 单值驻留

- **WHEN** 用户已揭示键 A，再点击揭示键 B
- **THEN** 页面只显示键 B 的值，键 A 的值不再显示

#### Scenario: 揭示读取文件值

- **WHEN** 外层环境存在与文件同名的变量且值不同，用户揭示该键
- **THEN** 页面显示文件中存储的值，而非外层环境的同名值

#### Scenario: 揭示经唯一实现记账

- **WHEN** 用户揭示任一键
- **THEN** 该次揭示产生 value-reveal 能力的值无关审计事件，编辑器自身不另行形成第二条揭示记录
