import { useEffect, useMemo, useRef, useState } from 'react';
import { timecode, type Project } from '../../../src/project/model';
import type { MediaRegistry } from '../../../src/media/registry';
import { AiClient } from '../../ai-api/client';
import { AnalysisClient } from '../../speech-auto-cut/src/client';
import { buildResult, scopeFor, segmentsFor, type Draft } from './plan';
import { extractAudio } from './audio';
import { PasswordGate } from './PasswordGate';
import './style.css';
type Props = {
  project: Project;
  lane: number;
  registry: MediaRegistry;
  onCancel: () => void;
  onApply: (expected: Project, result: Project) => void;
};
export default function AiGenDialog(p: Props) {
  const [authorized, setAuthorized] = useState(false);
  const [snapshot] = useState(p.project),
    [lane] = useState(p.lane);
  const scope = useMemo(() => scopeFor(snapshot, lane), [snapshot, lane]);
  const [analyzer] = useState(() => new AnalysisClient());
  const [status, setStatus] = useState<
    'idle' | 'analyzing' | 'transcribing' | 'review' | 'applying'
  >('idle');
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [error, setError] = useState<string>();
  const [stage, setStage] = useState('외부 전송 안내를 확인하고 시작하세요.'),
    [progress, setProgress] = useState(0);
  const [consent, setConsent] = useState(false),
    [page, setPage] = useState(0);
  const section = useRef<HTMLElement>(null),
    previousFocus = useRef(document.activeElement as HTMLElement | null);
  const controller = useRef<AbortController | undefined>(undefined),
    generation = useRef(0);
  const busy = status === 'analyzing' || status === 'transcribing' || status === 'applying';
  useEffect(() => {
    if (authorized) section.current?.focus();
  }, [authorized]);
  useEffect(() => {
    section.current?.focus();
    return () => {
      generation.current++;
      controller.current?.abort();
      analyzer.cancel();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [analyzer]);
  async function run(retry: boolean) {
    if (busy || !consent || !authorized) return;
    const id = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    const client = new AiClient();
    setError(undefined);
    setProgress(0);
    setStatus('analyzing');
    try {
      const capabilities = await client.capabilities(abort.signal);
      if (!capabilities.configured || !capabilities.operations.includes('transcribe'))
        throw new Error('서버에 사용 가능한 음성인식 공급자가 설정되지 않았습니다.');
      let work = drafts;
      if (!retry) {
        setDrafts([]);
        setPage(0);
        setStage('로컬에서 음성 구간 분석 중');
        const result = await analyzer.run(
          {
            purpose: 'caption',
            project: scope,
            files: p.registry.files(),
            options: {
              positive: 0.35,
              negative: 0.2,
              silenceMs: 300,
              minSpeechMs: 0,
              beforeMs: 0,
              afterMs: 0,
              minRemoveMs: 100,
            },
            assetBase: new URL(`${import.meta.env.BASE_URL}speech-auto-cut/`, document.baseURI)
              .href,
          },
          (value) => {
            if (generation.current === id) {
              setStage(value.stage);
              setProgress(value.progress * 0.3);
            }
          },
        );
        if (id !== generation.current) return;
        work = segmentsFor(scope, result.keep).map((segment) => ({
          segment,
          text: '',
          state: 'pending',
        }));
        setDrafts(work);
      }
      if (id !== generation.current) return;
      setStatus('transcribing');
      for (let i = 0; i < work.length; i++) {
        abort.signal.throwIfAborted();
        if (work[i].state === 'success') continue;
        const segment = work[i].segment;
        setStage(`음성 전사 중 · ${i + 1}/${work.length}`);
        try {
          const file = p.registry.get(segment.assetId)?.file;
          if (!file) throw new Error('원본 파일이 누락됐습니다.');
          const audio = await extractAudio(file, segment, abort.signal);
          if (
            audio.size > capabilities.maxAudioBytes ||
            (segment.endUs - segment.startUs) / 1e6 > capabilities.maxAudioSeconds
          )
            throw new Error('서버의 음성 조각 한도가 현재 작업보다 작습니다.');
          const response = await client.transcribe(audio, segment.id, abort.signal);
          work = work.map((draft, index) =>
            index === i
              ? { ...draft, text: response.text, state: 'success', error: undefined }
              : draft,
          );
        } catch (error) {
          if (abort.signal.aborted) throw error;
          work = work.map((draft, index) =>
            index === i
              ? {
                  ...draft,
                  state: 'failed',
                  error: error instanceof Error ? error.message : '전사 실패',
                }
              : draft,
          );
          // Stop after the first failure rather than repeatedly billing or hitting a broken API.
          if (id === generation.current) setDrafts(work);
          break;
        }
        if (id !== generation.current) return;
        setDrafts(work);
        setProgress(0.3 + (0.7 * (i + 1)) / work.length);
        // Stay below the built-in request-per-minute budget, including fast upstream responses.
        if (i + 1 < work.length)
          await new Promise<void>((resolve, reject) => {
            const cancel = () => {
              clearTimeout(timer);
              reject(new DOMException('취소', 'AbortError'));
            };
            const timer = setTimeout(() => {
              abort.signal.removeEventListener('abort', cancel);
              resolve();
            }, 2100);
            abort.signal.addEventListener('abort', cancel, { once: true });
          });
      }
      if (id !== generation.current) return;
      setStatus('review');
      setStage(
        !work.length
          ? '감지된 음성이 없습니다. 생성할 자막이 없습니다.'
          : work.every((d) => d.state === 'success')
            ? '전사 완료 · 내용을 확인하고 완료하세요.'
            : '일부 요청이 완료되지 않았습니다. 실패·미완료 구간을 재시도하세요.',
      );
      if (work.every((d) => d.state === 'success')) setProgress(1);
    } catch (error) {
      if (id !== generation.current) return;
      setStatus('idle');
      setError(error instanceof Error ? error.message : 'AI 작업 실패');
    }
  }
  function cancel() {
    if (status === 'applying') return;
    generation.current++;
    controller.current?.abort();
    analyzer.cancel();
    p.onCancel();
  }
  async function apply() {
    if (status !== 'review' || drafts.some((d) => d.state !== 'success')) return;
    setStatus('applying');
    setError(undefined);
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      p.onApply(snapshot, buildResult(snapshot, drafts));
    } catch (error) {
      setStatus('review');
      setError(error instanceof Error ? error.message : '적용 실패');
    }
  }
  const success = drafts.filter((d) => d.state === 'success').length;
  if (!authorized)
    return <PasswordGate onAuthorized={() => setAuthorized(true)} onCancel={cancel} />;
  return (
    <div className="modal-backdrop">
      <section
        className="dialog ai-gen-dialog"
        ref={section}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-gen-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
          }
          if (event.key !== 'Tab') return;
          const targets = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
            ),
          ];
          const first = targets[0],
            last = targets.at(-1);
          if (!first) {
            event.preventDefault();
            return;
          }
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header>
          <h2 id="ai-gen-title">AI Gen · 자동 자막 생성</h2>
        </header>
        <p>라인 {lane + 1}의 음성을 전사합니다. 완료할 때만 새 라인에 자막을 추가합니다.</p>
        <label className="ai-gen-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          음성 구간을 서버와 설정된 AI 공급자로 전송하며 과금될 수 있음을 확인했습니다. 취소해도
          이미 전송한 요청은 과금될 수 있습니다.
        </label>
        <div className="ai-gen-buttons">
          <button className="primary" disabled={busy || !consent} onClick={() => void run(false)}>
            {drafts.length ? '처음부터 다시 생성' : '자막 생성 시작'}
          </button>
          {drafts.some((d) => d.state !== 'success') && (
            <button disabled={busy || !consent} onClick={() => void run(true)}>
              실패·미완료 구간 재시도
            </button>
          )}
        </div>
        <div aria-live="polite">
          <p>{stage}</p>
          <progress aria-label="AI Gen 진행률" value={progress} max={1} />
          <p>
            성공 {success} · 실패 {drafts.filter((d) => d.state === 'failed').length} · 미완료{' '}
            {drafts.filter((d) => d.state === 'pending').length}
          </p>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="ai-gen-results">
          {drafts.slice(page * 20, (page + 1) * 20).map((draft) => (
            <label className="field" key={draft.segment.id}>
              {timecode(draft.segment.startUs, snapshot.fps)} –{' '}
              {timecode(draft.segment.endUs, snapshot.fps)}
              <textarea
                maxLength={2000}
                value={draft.text}
                disabled={busy || draft.state !== 'success'}
                aria-label={`자막 ${timecode(draft.segment.startUs, snapshot.fps)}`}
                onChange={(e) =>
                  setDrafts((values) =>
                    values.map((d) =>
                      d.segment.id === draft.segment.id ? { ...d, text: e.target.value } : d,
                    ),
                  )
                }
              />
              {draft.error && <small role="alert">{draft.error}</small>}
            </label>
          ))}
        </div>
        {drafts.length > 20 && (
          <div className="ai-gen-buttons">
            <button disabled={busy || page === 0} onClick={() => setPage((n) => n - 1)}>
              이전
            </button>
            <span>
              {page + 1}/{Math.ceil(drafts.length / 20)}
            </span>
            <button
              disabled={busy || (page + 1) * 20 >= drafts.length}
              onClick={() => setPage((n) => n + 1)}
            >
              다음
            </button>
          </div>
        )}
        <footer className="dialog-footer">
          <button disabled={status === 'applying'} onClick={cancel}>
            취소
          </button>
          <button
            className="primary"
            disabled={status !== 'review' || drafts.some((d) => d.state !== 'success')}
            onClick={() => void apply()}
          >
            {status === 'applying' ? '적용 중…' : '완료 · 타임라인에 적용'}
          </button>
        </footer>
      </section>
    </div>
  );
}
