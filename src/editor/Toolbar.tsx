import { duration, type Project } from '../project/model';

type Props = {
  project: Project;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onName: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpen: () => void;
  onSave: () => void;
  onNew:()=>void;
  onInstall: () => void;
  installed: boolean;
  installing: boolean;
  onExport: () => void;
  onHelp: () => void;
};
export function Toolbar(p: Props) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span>
          Devianns <strong>Clip Maker Plus</strong>
        </span>
      </div>
      <div className="project-name">
        <input
          aria-label="프로젝트 이름"
          maxLength={100}
          value={p.project.name}
          disabled={p.locked}
          onChange={(e) => p.onName(e.target.value)}
        />
      </div>
      <nav aria-label="프로젝트 도구">
        <button disabled={p.locked} onClick={p.onOpen}>
          열기
        </button>
        <button disabled={p.locked} onClick={p.onSave}>
          저장
        </button>
        <button disabled={p.locked} onClick={p.onNew}>새로 만들기</button>
        <button
          disabled={p.locked || p.installed || p.installing}
          onClick={p.onInstall}
          title={
            p.installed
              ? '앱으로 설치되었거나 앱 창에서 실행 중입니다.'
              : '앱 설치 또는 설치 방법 안내'
          }
        >
          {p.installed ? '설치됨' : p.installing ? '설치 중…' : '앱 설치'}
        </button>
        <span className="divider" />
        <button
          title="실행 취소 (Ctrl+Z)"
          aria-label="실행 취소"
          disabled={p.locked || !p.canUndo}
          onClick={p.onUndo}
        >
          ↶
        </button>
        <button
          title="다시 실행 (Ctrl+Shift+Z)"
          aria-label="다시 실행"
          disabled={p.locked || !p.canRedo}
          onClick={p.onRedo}
        >
          ↷
        </button>
        <button aria-label="단축키 도움말" onClick={p.onHelp}>
          ?
        </button>
        <button
          className="primary"
          disabled={p.locked || !duration(p.project)}
          onClick={p.onExport}
        >
          내보내기 ↗
        </button>
      </nav>
    </header>
  );
}
