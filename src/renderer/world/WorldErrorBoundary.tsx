import { Component, type ErrorInfo, type ReactNode } from 'react';

import { WorldUnavailable } from './WorldCanvas';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly crashed: boolean;
}

/**
 * Keeps a crash inside the world view from taking down the whole UI. React unmounts the
 * entire tree on an uncaught render error unless an error boundary catches it, and only
 * class components can be error boundaries.
 */
export class WorldErrorBoundary extends Component<Props, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[world] view crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      return (
        <section className="world" data-testid="world" data-state="crashed">
          <WorldUnavailable reason="The world view hit an unexpected error." />
        </section>
      );
    }
    return this.props.children;
  }
}
