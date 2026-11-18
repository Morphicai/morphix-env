// L1 能力：跨平台系统钥匙串适配（@napi-rs/keyring）。
// keytar 已归档且绑定 libsecret 的老构建链；@napi-rs/keyring 以预编译二进制
// 覆盖 macOS Keychain / Linux Secret Service 与 kernel keyutils / Windows
// Credential Manager。读模型随迁改为**声明键逐条读**（见 KeychainSource.keys）
// ——服务级发现（findCredentials）没有跨平台等价物，显式声明才是可移植面。
// 值纪律：值只经 Entry 的内存 API 往返，不经 argv/stdout/日志/审计。
import type { KeychainSource } from './contracts'

export type KeyringModule = typeof import('@napi-rs/keyring')

let keyringModule: KeyringModule | null | undefined
let keyringLoaderOverride: (() => Promise<KeyringModule | null>) | null = null

/** 测试专用注入点（非能力 API）：覆写 keyring 加载器；传 null 恢复默认并清缓存。 */
export function __setKeyringLoaderForTests(loader: (() => Promise<KeyringModule | null>) | null): void {
  keyringLoaderOverride = loader
  keyringModule = undefined
}

/**
 * @napi-rs/keyring is an optional native module (platform binaries arrive via
 * its own optionalDependencies). Load it lazily so machines where the binary
 * is missing keep a fully working CLI for every non-keychain source; only an
 * actual os-keychain source reports the missing module.
 */
export async function loadKeyring(): Promise<KeyringModule | null> {
  if (keyringLoaderOverride) return keyringLoaderOverride()
  if (keyringModule !== undefined) return keyringModule
  try {
    const imported = await import('@napi-rs/keyring')
    keyringModule = (imported as unknown as { default?: KeyringModule }).default ?? imported
  } catch {
    keyringModule = null
  }
  return keyringModule
}

/**
 * Linux 默认钉 Secret Service：keyring 的自动模式会静默回退 kernel
 * keyutils——那是"完全在内存、重启即失"的存储，作为密钥默认是错的。要
 * keyutils 必须显式声明（linuxStore: "keyutils"）。macOS/Windows 忽略此选项。
 */
function entryOptions(source: Pick<KeychainSource, 'linuxStore'>): { linux: { store: 'secret-service' | 'keyutils' } } {
  return { linux: { store: source.linuxStore ?? 'secret-service' } }
}

/** process.platform → 钥匙串平台面（source.platform 钉定校验用）。 */
export function keychainPlatform(): 'macos' | 'linux' | 'windows' | 'other' {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'linux') return 'linux'
  return 'other'
}

/** 平台相关的不可达提示（错误文案单点，值无关）。 */
export function keychainUnavailableHint(): string {
  if (process.platform === 'linux') {
    return ' On Linux the Secret Service (gnome-keyring, KWallet, keepassxc…) must be reachable over D-Bus; install one, or declare linuxStore: "keyutils" for a non-persistent kernel store.'
  }
  return ''
}

/** 读单条（不存在返回 null——与"键缺省"语义一致，不报错）。 */
export function readKeychainValue(
  keyring: KeyringModule,
  source: Pick<KeychainSource, 'service' | 'linuxStore'>,
  account: string,
): string | null {
  return new keyring.Entry(source.service, account, entryOptions(source)).getPassword()
}

/** 写单条（存在即覆盖）。 */
export function writeKeychainValue(
  keyring: KeyringModule,
  source: Pick<KeychainSource, 'service' | 'linuxStore'>,
  account: string,
  value: string,
): void {
  new keyring.Entry(source.service, account, entryOptions(source)).setPassword(value)
}

/** 删单条（不存在返回 false）。 */
export function deleteKeychainValue(
  keyring: KeyringModule,
  source: Pick<KeychainSource, 'service' | 'linuxStore'>,
  account: string,
): boolean {
  return new keyring.Entry(source.service, account, entryOptions(source)).deletePassword()
}
