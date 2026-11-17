import { useEffect, useRef, useState } from 'react'

/** Measured content width of an element, so charts draw in real pixels (never a stretched SVG). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
