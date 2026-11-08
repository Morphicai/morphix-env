# value-reveal Specification

## Purpose
提供密钥值的单键揭示能力（revealSingle）：系统所有"看某个键的值"的动作都经此唯一实现，并在能力内强制逐键授权、单值驻留与值无关审计，供编辑器、CLI 与常驻 daemon/面板共用。

## Requirements

### Requirement: 单键揭示唯一实现

系统所有面向展示的密钥值揭示 SHALL 经 value-reveal 能力（revealSingle）执行；任何组件（编辑器、CLI、daemon、面板）SHALL NOT 自行读取存储值用于展示。一次揭示 SHALL 返回且仅返回一个键的值。揭示 SHALL 要求显式授权上下文：默认锁定态（无有效授权上下文）SHALL 拒绝揭示。

#### Scenario: 授权下提取单键值

- **WHEN** 以有效授权上下文请求揭示键 K
- **THEN** 返回键 K 的当前存储值（来自其归属 provider，而非外层环境同名值）

#### Scenario: 锁定态拒绝

- **WHEN** 无授权上下文（默认锁定态）请求揭示任意键
- **THEN** 揭示被拒绝，且拒绝产生一条值无关审计事件

### Requirement: 单值驻留

揭示能力 SHALL 一次只驻留一个值：在同一驻留上下文中揭示新键时，先前驻留的值 SHALL 被立即清除。驻留的值 SHALL 为短暂存在（会话或短时授权窗口结束即失效）。

#### Scenario: 驻留互斥（同一驻留上下文）

- **WHEN** 在同一驻留上下文（slot）中键 A 的值仍在驻留，请求揭示键 B
- **THEN** 键 A 的驻留值被清除，仅键 B 的值驻留（不同 slot 各自独立驻留）

### Requirement: 值无关审计

每次揭示请求（成功、拒绝或失败）SHALL 追加一条审计事件，包含时间、键名、请求方标识与结果；审计事件 MUST NOT 包含任何密钥值。

#### Scenario: 成功揭示记账

- **WHEN** 键 K 被成功揭示
- **THEN** 审计新增一条事件，含键名 K、时间、请求方与成功结果，事件中无值

#### Scenario: 拒绝与失败同样记账

- **WHEN** 揭示因锁定态被拒绝或因键不存在而失败
- **THEN** 审计同样新增值无关事件（含失败/拒绝结果）

### Requirement: 值暴露面收敛

密钥值 SHALL 仅在 provider 与揭示请求方之间传输：MUST NOT 出现在 stdout/stderr、日志、错误信息、审计事件或任何持久化中间产物中。

#### Scenario: 错误信息不泄值

- **WHEN** 揭示过程出错（如键不存在、解密失败）
- **THEN** 错误信息说明原因但不含任何密钥值
