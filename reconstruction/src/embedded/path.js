export const sep = '/'

function normalize(value) {
  const absolute = value.startsWith('/')
  const parts = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const body = parts.join('/')
  return absolute ? `/${body}` : body
}

export function join(...parts) {
  return normalize(parts.filter((part) => part != null && part !== '').join('/'))
}

export function dirname(value) {
  const normalized = normalize(value)
  const index = normalized.lastIndexOf('/')
  if (index < 0) return '.'
  if (index === 0) return '/'
  return normalized.slice(0, index)
}

export function basename(value) {
  const normalized = normalize(value)
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

export function resolve(value) {
  if (typeof value !== 'string' || value.length === 0) return '/'
  return value.startsWith('/') ? normalize(value) : normalize(`/${value}`)
}

const path = { sep, join, dirname, basename, resolve }
export default path
