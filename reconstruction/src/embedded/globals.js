// shortcut: JavaScriptCore has no Buffer or process. This is only those two globals.

export class Buffer {
  constructor(bytes) {
    this.bytes = bytes
  }

  static from(value, encoding = 'utf8') {
    if (typeof value !== 'string') throw new Error('buffer')
    if (encoding === 'latin1' || encoding === 'binary') {
      const bytes = new Uint8Array(value.length)
      for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff
      return new Buffer(bytes)
    }
    return new Buffer(encodeUtf8(value))
  }

  static concat(list) {
    const size = list.reduce((sum, item) => sum + item.bytes.length, 0)
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const item of list) {
      bytes.set(item.bytes, offset)
      offset += item.bytes.length
    }
    return new Buffer(bytes)
  }

  static byteLength(value, encoding = 'utf8') {
    return Buffer.from(value, encoding).bytes.length
  }

  get length() {
    return this.bytes.length
  }

  subarray(start, end) {
    return new Buffer(this.bytes.subarray(start, end))
  }

  equals(other) {
    if (!other || this.bytes.length !== other.bytes.length) return false
    for (let index = 0; index < this.bytes.length; index += 1) {
      if (this.bytes[index] !== other.bytes[index]) return false
    }
    return true
  }

  toString(encoding = 'utf8') {
    if (encoding === 'latin1' || encoding === 'binary') return latin1(this.bytes)
    return decodeUtf8(this.bytes)
  }
}

// The workspace is plain data. JavaScriptCore in this app has no structuredClone.
export function structuredClone(value) {
  return JSON.parse(JSON.stringify(value))
}

export const process = {
  pid: 1,
  kill(pid) {
    if (pid === 1) return true
    const error = new Error('ESRCH')
    error.code = 'ESRCH'
    throw error
  },
}

function latin1(bytes) {
  let text = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return text
}

function encodeUtf8(text) {
  const bytes = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return Uint8Array.from(bytes)
}

function decodeUtf8(bytes) {
  let text = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index]
    if (first < 0x80) text += String.fromCharCode(first)
    else if ((first & 0xe0) === 0xc0) {
      const second = bytes[index += 1]
      text += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f))
    } else if ((first & 0xf0) === 0xe0) {
      const second = bytes[index += 1]
      const third = bytes[index += 1]
      text += String.fromCharCode(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f))
    } else {
      const second = bytes[index += 1]
      const third = bytes[index += 1]
      const fourth = bytes[index += 1]
      const code = ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f)
      text += String.fromCodePoint(code)
    }
  }
  return text
}
