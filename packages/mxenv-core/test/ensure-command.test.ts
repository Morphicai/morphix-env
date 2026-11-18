import { afterEach, describe, expect, it } from 'vitest'
import { ensureCommand } from '../src/sources'

// MXENV_<COMMAND>_BIN 钉定：面向 launchd/systemd 守护环境（无用户 PATH）、
// Nix/受限 PATH 安装。钉定优先于 local bin 与 PATH 解析；失效回落常规解析。

const KEY = 'MXENV_DOTENVX_BIN'

describe('ensureCommand pinned-binary override', () => {
  afterEach(() => {
    delete process.env[KEY]
  })

  it('honors MXENV_<COMMAND>_BIN ahead of local/PATH resolution', () => {
    process.env[KEY] = process.execPath // node 自答 --version
    expect(ensureCommand('dotenvx', 'src', 'dotenvx')).toBe(process.execPath)
  })

  it('dead pin falls through to normal resolution (or errors with the pin named)', () => {
    process.env[KEY] = '/nonexistent/mxenv-pin-test/dotenvx'
    try {
      const got = ensureCommand('dotenvx', 'src', 'dotenvx')
      expect(got).not.toBe('/nonexistent/mxenv-pin-test/dotenvx')
    } catch (error) {
      // 本机无任何 dotenvx 时：错误须带钉定线索（重钉或解钉指引）
      expect(String(error)).toContain('MXENV_DOTENVX_BIN')
    }
  })
})
