import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  title?: string;
  onReset?: () => void;
  resetLabel?: string;
}

/** Keeps a crash in one part of the UI (e.g. the 3D view) from taking down the app. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[workspace] UI error', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen">
        <div className="card">
          <div className="modal-icon danger" style={{ margin: '0 auto' }}>
            <AlertTriangle />
          </div>
          <h2>{this.props.title ?? 'Something went wrong'}</h2>
          <p>{this.state.error.message}</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            {this.props.resetLabel ?? 'Try again'}
          </button>
        </div>
      </div>
    );
  }
}
