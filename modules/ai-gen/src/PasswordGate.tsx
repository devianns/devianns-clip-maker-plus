import { useEffect, useRef, useState } from 'react';
import { AiClient } from '../../ai-api/client';
export function PasswordGate({
  onAuthorized,
  onCancel,
}: {
  onAuthorized: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit() {
    if (busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(undefined);
    try {
      await new AiClient().login(password, request.signal);
      if (request.signal.aborted) return;
      setPassword('');
      onAuthorized();
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : '비밀번호 확인 실패');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-password-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
          }
          if (event.key !== 'Tab') return;
          const targets = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled)',
            ),
          ];
          const first = targets[0],
            last = targets.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header>
          <h2 id="ai-password-title">AI Gen · 비밀번호 확인</h2>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            AI 사용 비밀번호
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="ai-password-note"
            />
          </label>
          <p id="ai-password-note">
            관리자가 설정한 비밀번호를 입력하세요. API 키나 PASSWORD 해시를 입력하는 곳이 아닙니다.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <footer className="dialog-footer">
            <button
              type="button"
              onClick={() => {
                controller.current?.abort();
                setPassword('');
                onCancel();
              }}
            >
              취소
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? '확인 중…' : '확인'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
