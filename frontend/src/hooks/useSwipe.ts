import { useEffect, useRef, useState, type RefObject } from 'react'

const EDGE_PX = 16       // leave screen edges to the browser (iOS back gesture)
const LOCK_PX = 10       // movement before deciding horizontal vs vertical
const TRIGGER_PX = 50    // horizontal distance that counts as a swipe

/**
 * Horizontal touch swipe on the element the returned callback ref is
 * attached to (a callback ref, so it works for elements that mount later).
 * Only engages once the gesture is clearly sideways, so vertical scrolling inside the area is unaffected.
 * While dragging, `dragRef` (if given) follows the finger.
 * `onSwipe(1)` = swiped left (next), `onSwipe(-1)` = swiped right (previous).
 * The scroll container inside the area needs `touch-action: pan-y pinch-zoom`,
 * or the browser claims horizontal drags (pointercancel).
 */
export function useSwipe(
  onSwipe: (dir: 1 | -1) => void,
  dragRef?: RefObject<HTMLElement | null>,
): (el: HTMLElement | null) => void {
  const onSwipeRef = useRef(onSwipe)
  onSwipeRef.current = onSwipe
  const [area, setArea] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!area) return
    let id: number | null = null
    let sx = 0, sy = 0, dx = 0
    let mode: 'x' | 'y' | null = null

    const setDrag = (px: number | null) => {
      const el = dragRef?.current
      if (!el) return
      el.style.transition = px === null ? 'transform .2s ease-out' : 'none'
      el.style.transform = px === null ? '' : `translateX(${px}px)`
    }

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      if (e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX) return
      id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; mode = null
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      const mx = e.clientX - sx, my = e.clientY - sy
      if (!mode) {
        if (Math.abs(mx) > LOCK_PX && Math.abs(mx) > Math.abs(my) * 1.2) mode = 'x'
        else if (Math.abs(my) > LOCK_PX) mode = 'y'
      }
      if (mode !== 'x') return
      dx = mx
      setDrag(dx * 0.6)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      id = null
      setDrag(null)
      if (mode === 'x' && Math.abs(dx) > TRIGGER_PX) onSwipeRef.current(dx < 0 ? 1 : -1)
      mode = null
    }

    area.addEventListener('pointerdown', down)
    area.addEventListener('pointermove', move)
    area.addEventListener('pointerup', up)
    area.addEventListener('pointercancel', up)
    return () => {
      area.removeEventListener('pointerdown', down)
      area.removeEventListener('pointermove', move)
      area.removeEventListener('pointerup', up)
      area.removeEventListener('pointercancel', up)
    }
  }, [area, dragRef])

  return setArea
}
