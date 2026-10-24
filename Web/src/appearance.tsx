import { t as tr } from './i18n'
import { useState, useSyncExternalStore } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { native, nativeAvailable, useWorkspace } from './workspace'

type Appearance = 'system' | 'light' | 'dark'
declare global {
  interface Window {
    nexoAppearance?: Appearance
  }
}
const modes = [
  { value: 'system', label: tr('Automático'), Icon: Monitor },
  { value: 'light', label: tr('Claro'), Icon: Sun },
  { value: 'dark', label: tr('Oscuro'), Icon: Moon },
] as const
const valid = (value: unknown): Appearance =>
  modes.some((mode) => mode.value === value) ? (value as Appearance) : 'system'
const media = window.matchMedia('(prefers-color-scheme: dark)')
let preference: Appearance = 'system'
try {
  preference = valid(
    nativeAvailable ? window.nexoAppearance : localStorage.getItem('nexo.appearance'),
  )
} catch {
  /* Storage may be unavailable in a private preview. */
}
const listeners = new Set<() => void>()
function apply() {
  const dark = preference === 'dark' || (preference === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#171719' : '#f5f5f7')
}
// Runs before React renders, including when opening a saved dark preference.
apply()
media.addEventListener('change', apply)
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function AppearanceControl() {
  const selected = useSyncExternalStore(subscribe, () => preference)
  const [saving, setSaving] = useState(false)
  const { notify } = useWorkspace()
  const choose = async (value: Appearance) => {
    if (saving || value === preference) return
    setSaving(true)
    try {
      if (nativeAvailable) await native('appearance', { value })
      else localStorage.setItem('nexo.appearance', value)
      preference = value
      apply()
      listeners.forEach((listener) => listener())
    } catch {
      notify(tr('No se pudo guardar el aspecto.'), true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="appearance-control" aria-label={tr('Aspecto')}>
      <h3>{tr('Aspecto')}</h3>
      <div className="appearance-options" role="group" aria-label={tr('Aspecto')}>
        {modes.map(({ value, label, Icon }) => (
          <button
            key={value}
            aria-pressed={selected === value}
            disabled={saving}
            onClick={() => void choose(value)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
