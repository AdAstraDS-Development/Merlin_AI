import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? (
      <main>
        <h1>Something went wrong</h1>
        <a href="/">Return home</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
