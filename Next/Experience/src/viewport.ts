export {}
// A hardware keyboard or a focused desktop search field must not hide navigation.
declare global {
  interface Window {
    nexoKeyboardVisible?: boolean
  }
}
const viewport = window.visualViewport
function updateViewport() {
  const editing = document.activeElement?.matches(
    'input:not([type=checkbox]):not([type=range]):not([type=color]), textarea, [contenteditable=true]',
  )
  const keyboard =
    !!editing &&
    (window.nexoKeyboardVisible === true ||
      ((viewport?.scale ?? 1) === 1 && innerHeight - (viewport?.height ?? innerHeight) > 120))
  document.documentElement.classList.toggle('keyboard-open', keyboard)
  document.documentElement.style.setProperty(
    '--viewport-height',
    `${keyboard ? (viewport?.height ?? innerHeight) : innerHeight}px`,
  )
  document.documentElement.style.setProperty(
    '--keyboard-inset',
    `${keyboard && !window.nexoKeyboardVisible ? Math.max(0, innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0)) : 0}px`,
  )
  if (keyboard)
    requestAnimationFrame(() => {
      const field = document.activeElement as HTMLElement | null
      const scroller = field?.closest(
        '.template-sheet-fields, .dialog-body, .touch-sheet, .studio-tools, .nx-sheet-body',
      ) as HTMLElement | null
      if (!field || !scroller) return
      const bounds = scroller.getBoundingClientRect(),
        target = field.getBoundingClientRect()
      if (target.top < bounds.top + 12) scroller.scrollTop += target.top - bounds.top - 12
      else if (target.bottom > bounds.bottom - 12)
        scroller.scrollTop += target.bottom - bounds.bottom + 12
    })
}
window.addEventListener('nexo-keyboard', updateViewport)
viewport?.addEventListener('resize', updateViewport)
window.addEventListener('resize', updateViewport)
document.addEventListener('focusin', updateViewport)
document.addEventListener('focusout', () => requestAnimationFrame(updateViewport))
updateViewport()
