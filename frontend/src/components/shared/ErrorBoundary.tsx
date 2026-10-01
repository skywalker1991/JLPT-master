import { Component, type ReactNode } from 'react'

/**
 * If a page fails while drawing, say so and offer a way back, instead of
 * leaving the whole screen blank.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; onBack?: () => void; backLabel?: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('page failed to draw', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-fg">这一页没显示出来。</p>
        <div className="flex gap-3">
          {this.props.onBack && (
            <button type="button" onClick={this.props.onBack} className="btn h-10 border border-border text-fg">
              回到{this.props.backLabel ?? '上一页'}
            </button>
          )}
          <button type="button" onClick={() => this.setState({ failed: false })} className="btn-primary h-10">再试一次</button>
        </div>
      </div>
    )
  }
}
