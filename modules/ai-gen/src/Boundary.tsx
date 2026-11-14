import { Component, type ReactNode } from 'react';
export function Pending({ onCancel, error }: { onCancel: () => void; error?: string }) {
  return (
    <div className="modal-backdrop">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI Gen"
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault();
          if (e.key === 'Tab') {
            e.preventDefault();
            e.currentTarget.querySelector('button')?.focus();
          }
        }}
      >
        <h2>{error ? 'AI Gen 오류' : 'AI Gen 준비 중…'}</h2>
        {error && <p role="alert">{error}</p>}
        <button autoFocus onClick={onCancel}>
          취소
        </button>
      </section>
    </div>
  );
}
export class AiGenBoundary extends Component<
  { children: ReactNode; onCancel: () => void },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'AI Gen 오류' };
  }
  render() {
    return this.state.error ? (
      <Pending onCancel={this.props.onCancel} error={this.state.error} />
    ) : (
      this.props.children
    );
  }
}
