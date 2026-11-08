/**
 * L1 值能力之二：单键揭示（revealSingle）——值展示的唯一出口。
 * 与 compose（组合注入）构成值能力双件套：compose 供进程注入，revealSingle
 * 供人眼展示。安全纪律内建于能力而非调用方（value-reveal spec）：
 *
 * - 授权校验：默认锁定态拒绝揭示（授权上下文由上层会话机制给出）；
 * - 单值驻留：每个驻留槽一次只持一个值，揭示新值即清旧驻留；
 * - 值无关审计：成功/拒绝/失败一律记 reveal 事件（键名/时间/请求方/结果，永不记值）；
 * - 暴露面收敛：值只返回给调用方，MUST NOT 出现在错误信息、审计或日志。
 *
 * 揭示对象是**来源存储值**（provider 里的存值），不经组合覆盖链——外层环境的
 * 同名值不参与（visual-editor spec 既有语义）。
 */
import { homedir } from 'os'
import type { ComposeOptions, LoadedSource, SecretProvider, SourceEntry } from './contracts'
import { writeAudit } from './audit'
import { loadSource } from './sources'

/** 揭示请求方标识（审计 via 维度）；daemon/panel 随 Wave B 扩展此 union。 */
export type RevealSubject = 'cli' | 'editor'

export class RevealError extends Error {
  readonly code: 'locked' | 'not-found'
  /** 审计已由能力记账的标记：调用方（如编辑器）据此避免对同一请求双记。 */
  readonly audited = true
  constructor(code: 'locked' | 'not-found', message: string) {
    super(message)
    this.name = 'RevealError'
    this.code = code
  }
}

export interface RevealParams {
  /** 要揭示的键名（keychain 来源为 account 名）。 */
  key: string
  /** 揭示对象来源：揭示其存储值。 */
  entry: SourceEntry
  /** 多文件来源的文件作用域（编辑器页内揭示只看该文件的存储值）。 */
  fileIndex?: number
  /** 请求方标识（审计用）。 */
  subject: RevealSubject
  /** 驻留槽 id（单值驻留粒度，如编辑会话 token）；一次只驻留一个值。 */
  slotId: string
  /** 授权上下文：缺省即锁定态（拒绝揭示）。上层会话机制负责给 true。 */
  authorized?: boolean
  /** 审计口径的 profile 名。 */
  profileName?: string
  options?: Pick<ComposeOptions, 'noInfisical' | 'envName' | 'allowInsecureGlobal' | 'homeDir'>
}

export interface StoredValue {
  value: string
  source: string
  provider: SecretProvider
}

export interface RevealResult extends StoredValue {
  /** 释放驻留（幂等）；驻留槽也会在短 TTL 后自动释放。 */
  release: () => void
}

// ─── 单值驻留槽（每 slotId 一个驻留，新揭示即清旧） ───────────────

const RESIDENCE_TTL_MS = 5 * 60_000
interface ResidentSlot {
  value: string
  timer: ReturnType<typeof setTimeout>
}
const resident = new Map<string, ResidentSlot>()

function releaseSlot(slotId: string, record?: ResidentSlot): void {
  const slot = resident.get(slotId)
  if (!slot) return
  // 旧 release 闭包不得误清新驻留：只释放自己的那份记录。
  if (record && slot !== record) return
  clearTimeout(slot.timer)
  // 释放值引用（JS 字符串无法物理擦除；见 design.md 决策 3）。
  slot.value = ''
  resident.delete(slotId)
}

function occupySlot(slotId: string, value: string): () => void {
  releaseSlot(slotId)
  const record: ResidentSlot = { value, timer: setTimeout(() => releaseSlot(slotId), RESIDENCE_TTL_MS) }
  record.timer.unref?.()
  resident.set(slotId, record)
  return () => releaseSlot(slotId, record)
}

/** 释放某驻留槽（编辑器隐藏/会话结束时调用）；幂等，未知槽为 no-op。 */
export function revealResidenceRelease(slotId: string): void {
  releaseSlot(slotId)
}

/** 测试专用内省（非能力 API）：当前驻留槽数量。 */
export function __residentSlotCountForTests(): number {
  return resident.size
}

// ─── 值无关审计 ─────────────────────────────────────────────────

function auditReveal(params: RevealParams, sources: string[], outcome: 'success' | 'failure', startedAt: number, reason?: 'locked' | 'not-found' | 'read-error'): void {
  writeAudit({
    timestamp: new Date().toISOString(),
    profile: params.profileName ?? '-',
    sources,
    keys: [params.key],
    outcome,
    durationMs: Date.now() - startedAt,
    via: params.subject,
    action: 'reveal',
    ...(reason ? { reason } : {}),
  }, params.options?.homeDir || homedir())
}

// ─── 单键存储值读取（低层原语，出口窄：只给一个值） ───────────────

function loadContext(params: Pick<RevealParams, 'options'>) {
  return {
    homeDir: params.options?.homeDir || homedir(),
    envName: params.options?.envName,
    noInfisical: params.options?.noInfisical,
    allowInsecureGlobal: params.options?.allowInsecureGlobal,
    // 揭示不经组合覆盖链：environment 仅服务 dotenvx bootstrap，不参与取值。
    // 剥离内联 DOTENV_PRIVATE_KEY* 材料：揭示读值不得让外壳里的私钥替代
    // .env.keys / 钥匙串托管（compose 路径的取舍另论，见 followup）。
    environment: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('DOTENV_PRIVATE_KEY')),
    ),
  }
}

/**
 * 从给定来源读单键存储值（provider 中的存值；外层环境同名值不参与）。
 * 未找到返回 null。这是揭示与未来消费方共用的唯一读值原语。
 *
 * 语义注记：每条 dotenvx 加载路径都展开 `$name` 序列（无 opt-out），因此含
 * `$` 的历史存值以其展开（consumer-visible）形式揭示——与 `set` 拒存新 `$`
 * 值、migrate 同语义（0.11 编辑器揭示行为原样保留）。
 */
export async function readStoredValueFromSource(
  entry: SourceEntry,
  key: string,
  options?: RevealParams['options'],
  fileIndex?: number,
): Promise<StoredValue | null> {
  // 多文件来源按文件作用域取值：与 set/del 的 fileIndex 语义对称——
  // 用户在文件 X 的页揭示键 K 就读文件 X 的存储值（同名跨文件不串读）。
  const files = 'files' in entry.source ? entry.source.files : undefined
  const scopedEntry: SourceEntry =
    fileIndex !== undefined && files && files[fileIndex] !== undefined
      ? { ...entry, source: { ...entry.source, files: [files[fileIndex]] } as SourceEntry['source'] }
      : entry
  const loaded: LoadedSource = await loadSource(scopedEntry, loadContext({ options }))
  const value = loaded.values[key]
  if (value === undefined) return null
  return { value, source: loaded.name, provider: loaded.provider }
}

/**
 * 按键名在来源列表中定位获胜来源并读其存储值：列表靠后且提供该键者获胜
 * （与 composeEnvironment 在合法 override 声明下的获胜语义一致；冲突配置
 * （同键且后者未声明 override）下 compose 拒绝组合，而揭示仍按后序返回）。
 * 未找到返回 null。
 */
export async function readStoredValue(
  key: string,
  entries: SourceEntry[],
  options?: RevealParams['options'],
): Promise<StoredValue | null> {
  for (let i = entries.length - 1; i >= 0; i--) {
    const found = await readStoredValueFromSource(entries[i], key, options)
    if (found) return found
  }
  return null
}

// ─── 值能力：revealSingle ───────────────────────────────────────

/**
 * 单键揭示（唯一实现）。成功返回值与 release；锁定态/键不存在抛 RevealError
 * （错误信息只含键名，永不含值），三路结果均落值无关 reveal 审计。
 */
export async function revealSingle(params: RevealParams): Promise<RevealResult> {
  const startedAt = Date.now()
  const sourceName = params.entry.name

  if (params.authorized !== true) {
    auditReveal(params, [sourceName], 'failure', startedAt, 'locked')
    throw new RevealError('locked', `[mxenv] Reveal of "${params.key}" is locked: no valid authorization context was provided.`)
  }

  let stored: StoredValue | null
  try {
    stored = await readStoredValueFromSource(params.entry, params.key, params.options, params.fileIndex)
  } catch (error) {
    auditReveal(params, [sourceName], 'failure', startedAt, 'read-error')
    // 读取层错误信息本就无值；原样抛出（value-reveal 暴露面收敛），
    // 并打 audited 标让调用方免于双记。
    ;(error as { audited?: boolean }).audited = true
    throw error
  }

  if (!stored) {
    auditReveal(params, [sourceName], 'failure', startedAt, 'not-found')
    throw new RevealError('not-found', `[mxenv] Key "${params.key}" has no stored value in source "${sourceName}".`)
  }

  const release = occupySlot(params.slotId, stored.value)
  auditReveal(params, [stored.source], 'success', startedAt)
  return { value: stored.value, source: stored.source, provider: stored.provider, release }
}
