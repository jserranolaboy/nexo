import { useLayoutEffect, useRef, useState } from 'react'

/** Two fingers zoom the page; one finger keeps native scrolling and inertia. */
export function usePaperZoom() {
  const scroll = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const value = useRef(1)
  useLayoutEffect(() => {
    const root = scroll.current!
    let pinch: { distance: number; zoom: number; x: number; y: number } | null = null
    const measure = () => setWidth(Math.min(620, root.clientWidth - 32))
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    measure()
    const point = (event: TouchEvent) => {
      const [a, b] = Array.from(event.touches)
      const rect = root.getBoundingClientRect()
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      }
    }
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      event.preventDefault()
      const p = point(event)
      pinch = {
        distance: p.distance,
        zoom: value.current,
        x: (p.x + root.scrollLeft) / value.current,
        y: (p.y + root.scrollTop) / value.current,
      }
    }
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const p = point(event),
        next = Math.max(1, Math.min(3, (pinch.zoom * p.distance) / pinch.distance))
      value.current = next
      setZoom(next)
      const x = pinch.x * next - p.x,
        y = pinch.y * next - p.y
      requestAnimationFrame(() => {
        root.scrollLeft = x
        root.scrollTop = y
      })
    }
    const end = () => {
      pinch = null
    }
    root.addEventListener('touchstart', start, { passive: false })
    root.addEventListener('touchmove', move, { passive: false })
    root.addEventListener('touchend', end)
    root.addEventListener('touchcancel', end)
    return () => {
      observer.disconnect()
      root.removeEventListener('touchstart', start)
      root.removeEventListener('touchmove', move)
      root.removeEventListener('touchend', end)
      root.removeEventListener('touchcancel', end)
    }
  }, [])
  return {
    scroll,
    width: width * zoom,
    zoom,
    reset: () => {
      value.current = 1
      setZoom(1)
    },
  }
}
