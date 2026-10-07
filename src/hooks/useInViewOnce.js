import { useEffect, useRef, useState } from 'react'

// Start card data shortly before the card enters the viewport. This keeps
// below-the-fold catalogue work out of the initial request burst while giving
// missing/stale cached heroes enough time to resolve from the live gallery.
export default function useInViewOnce(rootMargin = '320px') {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [inView, rootMargin])

  return [ref, inView]
}
