import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null }

/** Catches a crash inside one view so the rest of the app (player, sidebar, other views) keeps working, and lets the user retry. */
class Boundary extends Component<{ name: string; children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error(`${this.props.name} view crashed`, error, info.componentStack) }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <section role="alert" style={{ gridColumn: '2 / -1', gridRow: 1, padding: '64px 32px 32px', overflow: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{this.props.name} hit a problem</h2>
        <p className="dim">Everything else still works. Your data is untouched. If this keeps happening, restart the app.</p>
        <pre className="mono dim" style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </section>
    )
  }
}

/** Wraps a view with a crash guard and a loading boundary (for views loaded on demand). Neither adds any DOM while things are fine. */
export function ViewGuard({ name, children }: { name: string; children: ReactNode }): ReactNode {
  return <Boundary name={name}><Suspense fallback={null}>{children}</Suspense></Boundary>
}
