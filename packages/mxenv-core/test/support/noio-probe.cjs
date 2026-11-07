'use strict'
// 无 IO 副作用探针：先给各 IO 面的函数打补丁，再通过包名自引用
// require('@morphixai/mxenv-core/contracts')（走 exports map → dist 产物），
// 在进程退出时打印 JSON { resolved, calls, unpatched, exports }。
// exports 为契约入口的运行时导出键名快照，供断言导出面不含值能力
// （compose/composeEnvironment/revealSingle）。
//
// calls 元素为 { label, arg? }：fs / fs/promises 面记录首个参数（文件路径，
// 白名单断言需要），其余面只记 label。除白名单外的任何调用都算 import
// 触发了 IO 副作用。
//
// 白名单例外：Node CJS 加载器读取模块自身源文件的机制性 IO（实证
// node:internal/modules/cjs/loader：toRealPath → fs.realpathSync、
// defaultLoadImpl → fs.readFileSync），属任何 require 都必然发生的调用，
// 由调用方按 label + resolved 路径精确放行（不按 label 放宽）。
// Node 版本敏感——加载器机制性调用形态若变，先看这里。
//
// setup 阶段自噪声在 require 前清零（精确排除，非白名单放宽）：patch 安装等
// setup 步骤本身会触发 Node 运行时机制性调用（实证：stderr 为管道时
// process.stderr 惰性建 net.Socket，栈经 node:internal/assert → util/colors），
// 与被测模块 import 副作用无关，断言面从 require 起算。
//
// 覆盖面（动态枚举，名字不再手维护）：fs、fs/promises、net、tls、dgram、
// dns、dns/promises、child_process、http、https、worker_threads 的函数值
// own export 全包装（含类构造器，以及 fs.realpath.native 这类子函数面）；
// 另加 net.Socket.prototype.connect、net.Server.prototype.listen 与全局
// fetch / WebSocket（存在则）。
//
// 已知未覆盖面（如实声明）：cluster / inspector 等其余 node: 模块；实例方法面
// dgram.Socket.prototype.bind|send、dns.Resolver.prototype.resolve*、
// tls.TLSSocket 构造后行为；process 自身面。这些面上的 IO 本探针不保证捕获。
//
// unpatched：目标函数存在却未能替换（如未来 Node 冻结内建导出）的 label 清单，
// 必须为空——否则探针退化为假绿。目标名在该模块/原型上不存在（老 Node）不算。
//
// 跑在干净的 node 子进程里：vitest 自身的模块加载会碰 fs，进程内 spy 会假阳。
// 快照在进程退出时输出（覆盖 setTimeout / microtask / dynamic import 等延迟
// IO）；若 import 的模块挂住事件循环导致不退出，由调用方 spawnSync timeout
// 兜底判红（被挂住本身就是可疑信号）。
const calls = []
const unpatched = []

function safeNames(obj) {
  try {
    return Object.getOwnPropertyNames(obj)
  } catch {
    return []
  }
}

function tryGet(obj, name) {
  try {
    return obj[name]
  } catch {
    return undefined
  }
}

function makeWrapper(orig, label, recordArg) {
  const wrapper = function (...args) {
    calls.push(recordArg ? { label, arg: String(args[0]) } : { label })
    if (new.target) return Reflect.construct(orig, args, new.target)
    return orig.apply(this, args)
  }
  if (orig.prototype) wrapper.prototype = orig.prototype
  try {
    Object.defineProperty(wrapper, 'name', { value: orig.name })
  } catch {
    /* 命名失败不影响记录功能 */
  }
  return wrapper
}

// 包装单个函数面并自检替换成功（S1）；顺带把 orig 上的子函数面
// （如 fs.realpath.native）挂到 wrapper 上，堵住实例直调绕过。
function install(holder, name, label, recordArg) {
  const orig = tryGet(holder, name)
  if (typeof orig !== 'function') return // 不存在（老 Node）不算 unpatched
  const wrapper = makeWrapper(orig, label, recordArg)
  for (const sub of safeNames(orig)) {
    if (sub === 'prototype' || sub === 'constructor') continue
    const subOrig = tryGet(orig, sub)
    if (typeof subOrig !== 'function') continue
    wrapper[sub] = makeWrapper(subOrig, label + '.' + sub, recordArg)
  }
  try {
    try {
      holder[name] = wrapper
    } catch {
      /* getter-only 懒导出（如 http.WebSocket）：赋值抛错，改走 defineProperty */
    }
    if (holder[name] !== wrapper) {
      Object.defineProperty(holder, name, { value: wrapper, writable: true, configurable: true })
    }
    if (holder[name] !== wrapper) unpatched.push(label)
  } catch {
    unpatched.push(label)
  }
}

function instrument(mod, prefix, recordArg) {
  for (const name of safeNames(mod)) {
    install(mod, name, prefix + name, recordArg)
  }
}

function installMethod(cls, name, label) {
  const proto = tryGet(cls, 'prototype')
  if (!proto) return
  install(proto, name, label, false)
}

// 快照输出用补丁前保存的原始 fs.writeSync，避免自记录（S2）
const rawWriteSync = require('node:fs').writeSync

const MODULES = [
  ['node:fs', 'fs.', true],
  ['node:fs/promises', 'fs/promises.', true],
  ['node:net', 'net.', false],
  ['node:tls', 'tls.', false],
  ['node:dgram', 'dgram.', false],
  ['node:dns', 'dns.', false],
  ['node:dns/promises', 'dns/promises.', false],
  ['node:child_process', 'child_process.', false],
  ['node:http', 'http.', false],
  ['node:https', 'https.', false],
  ['node:worker_threads', 'worker_threads.', false],
]
for (const [id, prefix, recordArg] of MODULES) {
  let mod
  try {
    mod = require(id)
  } catch {
    continue // 模块整体不存在（老 Node）不算 unpatched
  }
  instrument(mod, prefix, recordArg)
}

installMethod(tryGet(require('node:net'), 'Socket'), 'connect', 'net.Socket.prototype.connect')
installMethod(tryGet(require('node:net'), 'Server'), 'listen', 'net.Server.prototype.listen')

install(globalThis, 'fetch', 'global.fetch', false)
install(globalThis, 'WebSocket', 'global.WebSocket', false)

const resolved = require.resolve('@morphixai/mxenv-core/contracts')

// 探针 setup 自噪声清零（精确排除，不是白名单放宽）：patch 安装/require.resolve
// 等 setup 步骤本身会触发 Node 运行时机制性调用，与被测模块的 import 副作用无关。
// 实证一例：stderr 为管道时 process.stderr 惰性 getter 由 createWritableStdioStream
// 建成 net.Socket（栈：node:internal/assert → util/colors → process.getStderr），
// 在 setup 阶段落进 calls。断言面从 require 起算，setup 阶段不计入。
calls.length = 0

const contracts = require('@morphixai/mxenv-core/contracts')

process.on('exit', () => {
  rawWriteSync(1, JSON.stringify({ resolved, calls, unpatched, exports: Object.keys(contracts) }))
})
