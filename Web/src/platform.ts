declare global {
  interface Window {
    nexoPlatform?: 'ios'
    nexoDevice?: 'iPhone' | 'iPad'
  }
}
export const isIOS = typeof window !== 'undefined' && window.nexoPlatform === 'ios'
export const deviceName = (typeof window !== 'undefined' && window.nexoDevice) || 'Mac'

export function selectionFeedback() {
  if (!isIOS) return
  void window.webkit?.messageHandlers?.valentina
    ?.postMessage({ command: 'selectionFeedback' })
    .catch(() => {})
}
