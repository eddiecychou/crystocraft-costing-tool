import { Component } from 'react'
import { useLocation, Link } from 'react-router-dom'

// React error boundaries must be class components — this is the only one in the
// app. It catches any render/lifecycle crash in the routed pages and shows a
// fallback instead of a blank white screen (which is what a thrown hook gives
// you). It's a safety net, not a fix: the underlying bug still needs solving,
// but the error becomes visible and recoverable instead of a silent crash.
class Boundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surfaces the component stack in the console for diagnosis.
    console.error('Page crashed:', error, info?.componentStack)
  }

  // Reset when the route changes, so navigating away from a broken page recovers.
  componentDidUpdate(prev) {
    if (prev.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="card p-5">
          <h1 className="text-lg text-ink mb-1">Something went wrong on this page</h1>
          <p className="text-sm text-ink-60 mb-3">
            The page hit an error and couldn’t render. This is a bug — the rest of the app still works.
          </p>
          <pre className="text-xs bg-ivory border border-warm-grey rounded-none p-2 overflow-auto text-red-600 mb-4">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div className="flex gap-2">
            <button onClick={() => this.setState({ error: null })} className="btn-secondary text-sm">Try again</button>
            <Link to={this.props.home || '/'} className="btn-primary text-sm">Back to safety</Link>
          </div>
        </div>
      </div>
    )
  }
}

// Functional wrapper so we can read the current path and pass it as the reset
// key. `home` is the route the "Back to safety" link points at.
export default function ErrorBoundary({ children, home }) {
  const { pathname } = useLocation()
  return <Boundary routeKey={pathname} home={home}>{children}</Boundary>
}
