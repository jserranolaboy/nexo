// shortcut: JavaScriptCore has no node:fs. nexoFs is the app host, and it only touches the temp directory.

import { Buffer } from './globals.js'

export function readFileSync(file, encoding) {
  const response = call('read', { path: file })
  const buffer = new Buffer(fromBase64(response.data))
  if (encoding === 'utf8') return buffer.toString('utf8')
  return buffer
}

export function writeFileSync(file, data) {
  if (typeof file === 'number') {
    const text = typeof data === 'string' ? data : data.toString('utf8')
    call('writefd', { fd: file, data: text })
    return
  }
  const bytes = typeof data === 'string' ? Buffer.from(data).bytes : data.bytes
  call('write', { path: file, data: toBase64(bytes) })
}

export function existsSync(file) {
  const response = call('exists', { path: file })
  return response.data === true
}

export function mkdirSync(file) {
  call('mkdir', { path: file })
}

export function renameSync(from, to) {
  call('rename', { from, to })
}

export function unlinkSync(file) {
  call('unlink', { path: file })
}

export function readdirSync(file) {
  return call('readdir', { path: file }).data
}

export function openSync(file) {
  return call('open', { path: file }).data
}

export function closeSync(fd) {
  call('close', { fd })
}

function call(op, payload) {
  if (typeof globalThis.nexoFs !== 'function') throw new Error('missing-host')
  const response = JSON.parse(globalThis.nexoFs(op, JSON.stringify(payload)))
  if (!response.ok) {
    const error = new Error(response.code || 'EIO')
    error.code = response.code || 'EIO'
    throw error
  }
  return response
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes) {
  let text = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    const triple = (first << 16) | (second << 8) | third
    text += alphabet[(triple >> 18) & 63]
    text += alphabet[(triple >> 12) & 63]
    text += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '='
    text += index + 2 < bytes.length ? alphabet[triple & 63] : '='
  }
  return text
}

function fromBase64(value) {
  const clean = (value || '').replace(/=+$/, '')
  const bytes = []
  for (let index = 0; index < clean.length; index += 4) {
    const triple =
      (alphabet.indexOf(clean[index]) << 18) |
      (alphabet.indexOf(clean[index + 1] || 'A') << 12) |
      (alphabet.indexOf(clean[index + 2] || 'A') << 6) |
      alphabet.indexOf(clean[index + 3] || 'A')
    bytes.push((triple >> 16) & 255)
    if (index + 2 < clean.length) bytes.push((triple >> 8) & 255)
    if (index + 3 < clean.length) bytes.push(triple & 255)
  }
  return Uint8Array.from(bytes)
}
