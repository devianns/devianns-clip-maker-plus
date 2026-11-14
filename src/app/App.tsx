import { prepareLocalFonts } from '../render/local-fonts';
import { usePwaInstall, type InstallResult } from '../pwa/usePwaInstall';
import { InstallDialog } from '../pwa/InstallDialog';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoCutUnavailable } from '../../modules/speech-auto-cut/src/eligibility';
import AutoCaptionDialog, { AutoCaptionBoundary } from '../../modules/auto-caption/src/AutoCaptionDialog';
import { captionUnavailable } from '../../modules/auto-caption/src/plan';
import { AiGenBoundary, Pending as AiGenPending } from '../../modules/ai-gen/src/Boundary';
import { unavailable as aiGenUnavailable } from '../../modules/ai-gen/src/plan';
import { AutoCutBoundary, AutoCutPending } from '../../modules/speech-auto-cut/src/ModuleBoundary';
import { AssetPanel } from '../editor/AssetPanel';
import { ExportDialog } from '../editor/ExportDialog';
import { Inspector, NumberField } from '../editor/Inspector';
import { HelpDialog } from '../editor/HelpDialog';
import { Dialog } from '../editor/Panel';
import { PreviewPanel } from '../editor/PreviewPanel';
import { Timeline } from '../editor/Timeline';
import { Toolbar } from '../editor/Toolbar';
import { Toast } from '../editor/Toast';
import { useShortcuts } from '../editor/useShortcuts';
import { ExportService, type ExportState } from '../export/service';
import { MediaRegistry } from '../media/registry';
import { PlaybackService, type PlaybackState } from '../playback/service';
import {
  historyReducer,
  initialHistory,
  type Command,
  type HistoryAction,
} from '../project/commands';
import {
  emptyProject,
  layout,
  laneCount,
  clipLane,
  clipUsesAsset,
  cueLane,
  seconds,
  toUs,
  type Asset,
  type Cue,
  type Clip,
  type Project,
} from '../project/model';
import { parseProject } from '../project/validation';
import { selectLineBlocks, timelineBlocks } from '../project/timeline-selection';
import { autosave, recover, saveProject } from '../storage/project-storage';

const AutoCutDialog = lazy(() => import('../../modules/speech-auto-cut/src/AutoCutDialog'));
const AiGenDialog = lazy(() => import('../../modules/ai-gen/src/AiGenDialog'));

export function App() {
  const installation = usePwaInstall();
  const [installResult, setInstallResult] = useState<InstallResult>({ status: 'unavailable' });
  const [history, setHistory] = useState(() => initialHistory(emptyProject()));
  const historyRef = useRef(history);
  historyRef.current = history;
  const project = history.present;
  const [registry] = useState(() => new MediaRegistry());
  const [playState, setPlayState] = useState<PlaybackState>({
    timeUs: 0,
    playing: false,
    buffering: false,
  });
  const [playback] = useState(() => new PlaybackService(registry, setPlayState));
  const [exportState, setExportState] = useState<ExportState>({
    status: 'idle',
    progress: 0,
    stage: '',
  });
  const [exporter] = useState(() => new ExportService(setExportState));
  const [selected, setSelected] = useState<string>();
  const [selectedCue, setSelectedCue] = useState<string>();
  const [selectedCueIds, setSelectedCueIds] = useState<string[]>([]);
  const [inspectorTab, setInspectorTab] = useState<'clip' | 'subtitle'>('clip');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLane, setActiveLane] = useState(0);
  const cueClipboard = useRef<{ clips: Clip[]; cues: Cue[] } | undefined>(undefined);
  const pendingSeek = useRef<number | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const importRef = useRef(false);
  const [message, setMessage] = useState<string>();
  const dismissMessage = useCallback(() => setMessage(undefined), []);
  const [notice, setNotice] = useState('영상 파일은 서버로 전송되지 않습니다.');
  const [modal, setModal] = useState<
    'export' | 'help' | 'recover' | 'autoCut' | 'autoCaption' | 'aiGen' | 'deleteLane' | 'install'|'newProject'|'deleteAsset'
  >();
  const [newProjectRequest,setNewProjectRequest]=useState<Project>();
  const [newProjectSaved,setNewProjectSaved]=useState(false);
  const [deleteAssetRequest,setDeleteAssetRequest]=useState<{id:string;project:Project;count:number}>();
  const [autoCutTarget, setAutoCutTarget] = useState<string>();
  const [deleteLaneRequest, setDeleteLaneRequest] = useState<{
    lane: number;
    project: Project;
    videos: number;
    cues: number;
  }>();
  const [recovery, setRecovery] = useState<Project>();
  const [restoreReady, setRestoreReady] = useState(false);
  const [registryVersion, setRegistryVersion] = useState(0);
  const projectPicker = useRef<HTMLInputElement>(null);
  const reconnectPicker = useRef<HTMLInputElement>(null);
  const reconnectAsset = useRef<Asset | undefined>(undefined);
  const locked =
    exportState.status === 'running' ||
    importing ||
    modal === 'autoCut' ||
    modal === 'autoCaption' ||
    modal === 'aiGen' ||
    modal === 'deleteLane' ||
    modal === 'newProject' || modal==='deleteAsset' ||
    installation.installing;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const supported =
    globalThis.isSecureContext &&
    typeof globalThis.VideoDecoder === 'function' &&
    typeof globalThis.OffscreenCanvas === 'function';
  const autoCutReason = useMemo(
    () =>
      supported
        ? autoCutUnavailable(project, registry, selectedCueIds.length ? [] : selectedIds)
        : '이 브라우저는 음성 분석을 지원하지 않습니다.',
    [supported, project, registry, registryVersion, selectedIds, selectedCueIds],
  );
  const captionLane = Math.min(activeLane, laneCount(project) - 1);
  const autoCaptionReason = useMemo(
    () => captionUnavailable(project, registry, captionLane),
    [project, registry, registryVersion, captionLane],
  );
  function act(action: HistoryAction) {
    if (lockedRef.current) return false;
    try {
      const next = historyReducer(historyRef.current, action);
      if (next === historyRef.current) return false;
      if (action.type === 'load') {
        setSelectedCueIds([]);
        cueClipboard.current = undefined;
        pendingSeek.current = undefined;
      }
      playback.pause();
      historyRef.current = next;
      setHistory(next);
      setMessage(undefined);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  function command(cmd: Command) {
    return act({ type: 'command', command: cmd });
  }
  function createProject(){
    if(modal!=='newProject'||!newProjectRequest)return;
    if(historyRef.current.present!==newProjectRequest){setMessage('프로젝트가 변경됐습니다. 취소 후 다시 시도하세요.');return;}
    playback.pause();
    const next=initialHistory(emptyProject());
    historyRef.current=next;pendingSeek.current=0;cueClipboard.current=undefined;reconnectAsset.current=undefined;
    setHistory(next);setSelected(undefined);setSelectedIds([]);setSelectedCue(undefined);setSelectedCueIds([]);setActiveLane(0);setInspectorTab('clip');setRecovery(undefined);setAutoCutTarget(undefined);setExportState({status:'idle',progress:0,stage:''});
    setMessage(undefined);setNotice('새 프로젝트를 만들었습니다.');setModal(undefined);setNewProjectRequest(undefined);setNewProjectSaved(false);
  }
  function removeAsset(id:string){
    if(lockedRef.current)return;
    const current=historyRef.current.present;if(!current.assets.some(a=>a.id===id))return;
    const count=current.clips.filter(c=>clipUsesAsset(c,id)).length;
    if(count){playback.pause();setMessage(undefined);setDeleteAssetRequest({id,project:current,count});setModal('deleteAsset');}
    else if(command({type:'removeAsset',id})){
      if(cueClipboard.current?.clips.some(c=>clipUsesAsset(c,id)))cueClipboard.current=undefined;
    }
  }
  function confirmRemoveAsset(){
    const request=deleteAssetRequest;if(modal!=='deleteAsset'||!request)return;
    try{
      if(historyRef.current.present!==request.project)throw new Error('프로젝트가 변경됐습니다. 취소 후 다시 시도하세요.');
      const next=historyReducer(historyRef.current,{type:'command',command:{type:'removeAsset',id:request.id}});
      playback.pause();historyRef.current=next;setHistory(next);
      if(cueClipboard.current?.clips.some(c=>clipUsesAsset(c,request.id)))cueClipboard.current=undefined;
      setDeleteAssetRequest(undefined);setModal(undefined);setMessage(undefined);
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  }
  function applyAutoCut(expected: Project, result: Project) {
    if (
      modal !== 'autoCut' ||
      historyRef.current.present !== expected ||
      importing ||
      exportState.status === 'running'
    )
      throw new Error('분석 중 프로젝트 상태가 변경됐습니다. 취소하고 다시 분석하세요.');
    const current = historyRef.current.present;
    const validated = parseProject(
      JSON.stringify({
        ...current,
        laneCount: result.laneCount,
        clips: result.clips,
        subtitles: result.subtitles,
      }),
    );
    if (!validated.clips.length) throw new Error('남길 영상이 없어 완료할 수 없습니다.');
    const next = historyReducer(historyRef.current, {
      type: 'command',
      command: {
        type: 'replaceTimeline',
        laneCount: validated.laneCount,
        clips: validated.clips,
        subtitles: validated.subtitles,
      },
    });
    playback.pause();
    historyRef.current = next;
    pendingSeek.current = layout(current).find((r) => r.clip.id === autoCutTarget)?.startUs ?? 0;
    cueClipboard.current = undefined;
    setHistory(next);
    setSelected(undefined);
    setSelectedIds([]);
    setSelectedCue(undefined);
    setSelectedCueIds([]);
    setInspectorTab('clip');
    setMessage(undefined);
    setModal(undefined);
    setNotice('Auto Cut 적용 완료 · 실행 취소로 원래 타임라인을 복구할 수 있습니다.');
  }
  function applyAutoCaption(expected: Project, result: Project) {
    if (modal !== 'autoCaption' || historyRef.current.present !== expected || importing || exportState.status === 'running')
      throw new Error('분석 중 프로젝트 상태가 변경됐습니다. 취소하고 다시 분석하세요.');
    // Validate and construct the history entry before committing any state.
    const validated = parseProject(JSON.stringify(result));
    if (result !== expected) {
      const next = historyReducer(historyRef.current, { type: 'command', command: {
        type: 'replaceTimeline', laneCount: validated.laneCount,
        clips: validated.clips, subtitles: validated.subtitles,
      }});
      playback.pause();
      historyRef.current = next;
      setHistory(next);
      setActiveLane(laneCount(validated) - 1);
      setSelected(undefined); setSelectedIds([]); setSelectedCue(undefined); setSelectedCueIds([]);
      setInspectorTab('subtitle');
    }
    setModal(undefined); setMessage(undefined);
    setNotice(result === expected ? '감지된 음성이 없어 자막을 생성하지 않았습니다.' : 'Auto Caption 적용 완료 · 새 라인에 빈 자막을 추가했습니다. 실행 취소로 복구할 수 있습니다.');
  }
  function applyAiGen(expected: Project, result: Project) {
    if (modal !== 'aiGen' || historyRef.current.present !== expected || importing || exportState.status === 'running')
      throw new Error('프로젝트가 변경됐습니다. 취소 후 다시 생성하세요.');
    if (result !== expected) {
      const validated = parseProject(JSON.stringify(result));
      // Only the new subtitle line can cross this boundary; existing project data stays untouched.
      if (JSON.stringify(validated.clips) !== JSON.stringify(expected.clips) ||
        JSON.stringify(validated.subtitles.slice(0, expected.subtitles.length)) !== JSON.stringify(expected.subtitles))
        throw new Error('AI 결과에 기존 타임라인 변경이 포함되어 있습니다.');
      const next = historyReducer(historyRef.current, {type:'command',command:{type:'replaceTimeline',
        clips:expected.clips, subtitles:validated.subtitles, laneCount:validated.laneCount}});
      playback.pause(); historyRef.current = next; setHistory(next);
      setActiveLane(laneCount(validated)-1); setSelected(undefined);setSelectedIds([]);setSelectedCue(undefined);setSelectedCueIds([]);
      setInspectorTab('subtitle');
    }
    setModal(undefined);setMessage(undefined);
    setNotice(result === expected ? '생성할 자막이 없습니다.' : 'AI Gen 적용 완료 · 실행 취소로 복구할 수 있습니다.');
  }
  function split() {
    command({ type: 'split', timeUs: playState.timeUs });
  }
  function deleteLane() {
    if (lockedRef.current) return;
    const current = historyRef.current.present,
      lane = Math.min(activeLane, laneCount(current) - 1);
    const videos = current.clips.filter((c) => clipLane(c) === lane).length,
      cues = current.subtitles.filter((c) => cueLane(c) === lane).length;
    if (videos || cues) {
      playback.pause();
      setMessage(undefined);
      setDeleteLaneRequest({ lane, project: current, videos, cues });
      setModal('deleteLane');
    } else if (command({ type: 'deleteLane', lane }))
      setActiveLane(Math.min(lane, Math.max(0, laneCount(current) - 2)));
  }
  function moveLane(direction: -1 | 1) {
    const lane = Math.min(activeLane, laneCount(project) - 1);
    if (command({ type: 'moveLane', lane, direction })) setActiveLane(lane + direction);
  }
  function confirmDeleteLane() {
    const request = deleteLaneRequest;
    if (modal !== 'deleteLane' || !request) return;
    try {
      if (historyRef.current.present !== request.project)
        throw new Error('프로젝트가 변경됐습니다. 취소하고 라인 삭제를 다시 실행하세요.');
      const next = historyReducer(historyRef.current, {
        type: 'command',
        command: { type: 'deleteLane', lane: request.lane },
      });
      playback.pause();
      historyRef.current = next;
      setHistory(next);
      setActiveLane(Math.min(request.lane, laneCount(next.present) - 1));
      setModal(undefined);
      setDeleteLaneRequest(undefined);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  function merge() {
    if (selectedCueIds.length || selectedIds.length < 2) return;
    command({ type: 'merge', ids: selectedIds });
  }
  function remove() {
    if (!selectedIds.length && !selectedCueIds.length) return;
    if (command({ type: 'deleteBlocks', ids: [...selectedIds, ...selectedCueIds] })) {
      setSelectedCue(undefined);
      setSelectedCueIds([]);
      setSelectedIds([]);
      setSelected(undefined);
    }
  }
  function selectClip(id: string, additive = false, seek = true) {
    const target = project.clips.find((c) => c.id === id);
    if (target) setActiveLane(clipLane(target));
    playback.pause();
    const ids = additive
      ? selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
      : [id];
    setSelectedIds(ids);
    setSelected(ids.at(-1));
    const row = layout(project).find((c) => c.clip.id === id);
    if (row && seek) playback.seek(row.startUs);
    if (!additive) {
      setSelectedCue(undefined);
      setSelectedCueIds([]);
    }
    setInspectorTab('clip');
  }
  function selectCue(id?: string, additive = false) {
    const target = project.subtitles.find((c) => c.id === id);
    if (target) setActiveLane(cueLane(target));
    playback.pause();
    const ids = !id
      ? []
      : additive
        ? selectedCueIds.includes(id)
          ? selectedCueIds.filter((value) => value !== id)
          : [...selectedCueIds, id]
        : [id];
    setSelectedCueIds(ids);
    setSelectedCue(ids.length === 1 ? ids[0] : undefined);
    if (!additive) {
      setSelectedIds([]);
      setSelected(undefined);
    }
    setInspectorTab('subtitle');
  }
  function copyCue() {
    const clips = layout(project)
      .filter((r) => selectedIds.includes(r.clip.id) || r.clip.id === selected)
      .map((r) => ({ ...r.clip, startUs: r.startUs }));
    const cues = project.subtitles.filter((c) => selectedCueIds.includes(c.id));
    if (!clips.length && !cues.length) return false;
    cueClipboard.current = structuredClone({ clips, cues });
    return true;
  }
  function cutBlocks() {
    if (!copyCue()) return false;
    const copied = cueClipboard.current!;
    if (
      command({ type: 'deleteBlocks', ids: [...copied.clips, ...copied.cues].map((c) => c.id) })
    ) {
      setSelectedIds([]);
      setSelected(undefined);
      setSelectedCueIds([]);
      setSelectedCue(undefined);
    }
    return true;
  }
  function selectAll() {
    const blocks = selectLineBlocks(
      timelineBlocks(project),
      Math.min(activeLane, laneCount(project) - 1),
      [...selectedIds, ...selectedCueIds],
    );
    if (!blocks.length) return false;
    playback.pause();
    const clips = blocks.filter((b) => b.kind === 'video').map((b) => b.id),
      cues = blocks.filter((b) => b.kind === 'subtitle').map((b) => b.id);
    setSelectedIds(clips);
    setSelected(selected && clips.includes(selected) ? selected : clips.at(-1));
    setSelectedCueIds(cues);
    setSelectedCue(cues.length === 1 ? cues[0] : undefined);
    if (!cues.length) setInspectorTab('clip');
    else if (!clips.length) setInspectorTab('subtitle');
    return true;
  }
  function pasteCue() {
    const copied = cueClipboard.current;
    if (!copied) return false;
    const before = new Set([...project.clips, ...project.subtitles].map((c) => c.id));
    if (
      command({
        type: 'pasteBlocks',
        ...copied,
        timeUs: playState.timeUs,
        lane: Math.min(activeLane, laneCount(project) - 1),
      })
    ) {
      const next = historyRef.current.present;
      const clips = next.clips.filter((c) => !before.has(c.id)),
        cues = next.subtitles.filter((c) => !before.has(c.id));
      setSelectedIds(clips.map((c) => c.id));
      setSelected(clips.at(-1)?.id);
      setSelectedCueIds(cues.map((c) => c.id));
      setSelectedCue(cues.length === 1 ? cues[0].id : undefined);
      setInspectorTab(cues.length ? 'subtitle' : 'clip');
    }
    return true;
  }
  function toggle() {
    if (playState.playing) playback.pause();
    else void playback.play();
  }
  function seekFrame(delta: number) {
    playback.seek(playState.timeUs + Math.round((delta * 1_000_000) / project.fps));
  }
  function undo() {
    act({ type: 'undo' });
  }
  function redo() {
    act({ type: 'redo' });
  }
  function insert(assetId: string) {
    command({
      type: 'insert',
      assetId,
      index: project.clips.length,
      lane: Math.min(activeLane, laneCount(project) - 1),
      timeUs: playState.timeUs,
    });
  }
  useShortcuts({
    cutBlocks,
    selectAll,
    locked,
    modal: !!modal,
    toggle,
    seekFrame,
    split,
    merge,
    remove,
    undo,
    redo,
    copyCue,
    pasteCue,
  });
  useEffect(() => {
    const cueIds = selectedCueIds.filter((id) => project.subtitles.some((c) => c.id === id));
    if (cueIds.length !== selectedCueIds.length) setSelectedCueIds(cueIds);
    setSelectedCue(cueIds.length === 1 ? cueIds[0] : undefined);
    if (selected && !project.clips.some((c) => c.id === selected)) setSelected(undefined);
    setSelectedIds((ids) =>
      ids.every((id) => project.clips.some((c) => c.id === id))
        ? ids
        : ids.filter((id) => project.clips.some((c) => c.id === id)),
    );
    if (selectedCue && !project.subtitles.some((c) => c.id === selectedCue))
      setSelectedCue(undefined);
  }, [project, selected, selectedCue, selectedCueIds]);
  useEffect(() => {
    let active = true;
    void prepareLocalFonts(project)
      .catch((error) => {
        if (active) setMessage(String(error));
      })
      .then(() => {
        if (!active) return;
        playback.bind(project);
        if (pendingSeek.current !== undefined) {
          playback.seek(pendingSeek.current);
          pendingSeek.current = undefined;
        }
      });
    return () => {
      active = false;
    };
  }, [playback, project, registryVersion]);
  useEffect(() => {
    const ids = new Set(
      [...history.past, history.present, ...history.future].flatMap((p) =>
        p.assets.map((a) => a.id),
      ),
    );
    registry.retain(ids);
  }, [history, registry]);
  useEffect(() => {
    if (exportState.status === 'running') playback.suspendPreview();
    else playback.refresh();
  }, [exportState.status, playback]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) playback.pause();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [playback]);
  useEffect(() => {
    let active = true;
    void recover()
      .then((p) => {
        if (active && p && (p.clips.length || p.assets.length || p.subtitles.length)) {
          setRecovery(p);
          setModal('recover');
        }
      })
      .catch(() => {
        if (active) setNotice('자동 복구를 읽지 못했습니다. JSON으로 프로젝트를 저장하세요.');
      })
      .finally(() => {
        if (active) setRestoreReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!restoreReady || modal === 'recover') return;
    const timer = setTimeout(() => {
      void autosave(project)
        .then(() => setNotice('편집 상태 자동 저장됨 · 원본은 별도로 보관하세요.'))
        .catch(() => setNotice('자동 저장 실패 · JSON 프로젝트를 저장하세요.'));
    }, 700);
    return () => clearTimeout(timer);
  }, [project, restoreReady, modal]);
  useEffect(
    () => () => {
      playback.dispose();
      exporter.dispose();
      registry.dispose();
    },
    [playback, exporter, registry],
  );

  async function importFiles(files: File[]) {
    if (!files.length || importRef.current || exportState.status === 'running') return;
    if (historyRef.current.present.assets.length + files.length > 500) {
      setMessage('에셋은 최대 500개까지 추가할 수 있습니다.');
      return;
    }
    importRef.current = true;
    setImporting(true);
    playback.pause();
    const assets: Asset[] = [],
      failures: string[] = [];
    for (const file of files) {
      try {
        assets.push(await registry.add(file));
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (assets.length) {
      const next = historyReducer(historyRef.current, {
        type: 'command',
        command: { type: 'assets', assets },
      });
      historyRef.current = next;
      setHistory(next);
    }
    setMessage(failures.length ? failures.join('\n') : undefined);
    setNotice(`${assets.length}개 에셋을 가져왔습니다. 타임라인에 추가하세요.`);
    setRegistryVersion((v) => v + 1);
    setImporting(false);
    importRef.current = false;
  }
  async function reconnect(file: File) {
    const asset = reconnectAsset.current;
    if (!asset) return;
    setImporting(true);
    try {
      await registry.add(file, asset);
      setMessage(undefined);
      setRegistryVersion((v) => v + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
      reconnectAsset.current = undefined;
    }
  }
  return (
    <div className="app-shell">
      <Toolbar
        onNew={()=>{if(lockedRef.current||!restoreReady)return;playback.pause();setNewProjectRequest(historyRef.current.present);setNewProjectSaved(false);setMessage(undefined);setModal('newProject');}}
        installed={installation.installed}
        installing={installation.installing}
        onInstall={() => {
          if (lockedRef.current) return;
          playback.pause();
          void installation.requestInstall().then((result) => {
            if (
              result.status === 'accepted' ||
              result.status === 'installed' ||
              result.status === 'pending'
            )
              return;
            setInstallResult(result);
            setModal('install');
          });
        }}
        project={project}
        locked={locked}
        canUndo={!!history.past.length}
        canRedo={!!history.future.length}
        onName={(name) => command({ type: 'settings', patch: { name } })}
        onUndo={undo}
        onRedo={redo}
        onOpen={() => projectPicker.current?.click()}
        onSave={() => saveProject(project)}
        onExport={() => {
          playback.pause();
          setExportState({ status: 'idle', progress: 0, stage: '' });
          setModal('export');
        }}
        onHelp={() => setModal('help')}
      />
      <input
        ref={projectPicker}
        type="file"
        accept=".json"
        hidden
        data-testid="project-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 2_000_000) {
            setMessage('프로젝트 파일은 2MB 이하만 지원합니다.');
            return;
          }
          void file
            .text()
            .then((text) => {
              act({ type: 'load', project: parseProject(text) });
              setSelected(undefined);
              setSelectedCue(undefined);
              playback.seek(0);
            })
            .catch((error) => setMessage(error.message));
        }}
      />
      <input
        ref={reconnectPicker}
        type="file"
        hidden
        accept="video/*,.mkv"
        data-testid="reconnect-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void reconnect(file);
        }}
      />
      <div className="toast-region" role="region" aria-label="알림">
        {!supported && (
          <Toast message="HTTPS 또는 localhost의 최신 Chrome·Edge에서 여세요. 이 환경은 WebCodecs/OffscreenCanvas를 지원하지 않습니다." />
        )}
        {message && <Toast message={message} onDismiss={dismissMessage} />}
      </div>
      <main className="workspace" aria-busy={locked}>
        <AssetPanel
          onRemove={removeAsset}
          project={project}
          registry={registry}
          importing={importing}
          locked={locked || !supported}
          onImport={(files) => void importFiles(files)}
          onInsert={insert}
          onReconnect={(asset) => {
            reconnectAsset.current = asset;
            reconnectPicker.current?.click();
          }}
        />
        <PreviewPanel
          key={project.id}
          selectedIds={selectedIds}
          project={project}
          selected={selected}
          onTransform={(id, transform, mode) =>
            selectedIds.length > 1
              ? command({
                  type: 'transforms',
                  ids: selectedIds,
                  patch:
                    mode === 'move'
                      ? { x: transform.x, y: transform.y }
                      : mode === 'resize'
                        ? { scale: transform.scale }
                        : {
                            crop: transform.crop,
                            scale: transform.scale,
                            x: transform.x,
                            y: transform.y,
                          },
                })
              : command({ type: 'transform', id, transform })
          }
          state={playState}
          playback={playback}
          locked={locked}
          onSeek={(us) => playback.seek(us)}
          onToggle={toggle}
        />
        <Inspector
          activeLane={Math.min(activeLane, laneCount(project) - 1)}
          selectedIds={selectedIds}
          selectedCueIds={selectedCueIds}
          project={project}
          selected={selected}
          selectedCue={selectedCue}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onSelectCue={selectCue}
          timeUs={playState.timeUs}
          locked={locked}
          onCommand={command}
          onSeek={(us) => playback.seek(us)}
        />
        <Timeline
          key={project.id}
          onClearSelection={() => {
            setSelected(undefined);
            setSelectedIds([]);
            setSelectedCue(undefined);
            setSelectedCueIds([]);
          }}
          onMoveLane={moveLane}
          onDeleteLane={deleteLane}
          activeLane={Math.min(activeLane, laneCount(project) - 1)}
          onLaneChange={setActiveLane}
          selectedCueIds={selectedCueIds}
          autoCutUnavailable={autoCutReason}
          autoCaptionUnavailable={autoCaptionReason}
          aiGenUnavailable={aiGenUnavailable(project, registry, captionLane)}
          onAiGen={() => {
            if (locked || aiGenUnavailable(project,registry,captionLane)) return;
            playback.pause();setModal('aiGen');
          }}
          onAutoCaption={() => {
            if (locked || captionUnavailable(project, registry, captionLane)) return;
            playback.pause();
            setModal('autoCaption');
          }}
          onAutoCut={() => {
            if (
              !locked &&
              !autoCutUnavailable(project, registry, selectedCueIds.length ? [] : selectedIds)
            ) {
              playback.pause();
              setAutoCutTarget(selectedIds[0]);
              setModal('autoCut');
            }
          }}
          selectedIds={selectedIds}
          onMerge={merge}
          project={project}
          selected={selected}
          selectedCue={selectedCue}
          timeUs={playState.timeUs}
          locked={locked}
          onSelect={selectClip}
          onSelectCue={selectCue}
          onSeek={(us) => playback.seek(us)}
          onCommand={command}
          onSplit={split}
          onDelete={remove}
        />
      </main>
      <footer className="statusbar">
        <span>
          <i className="status-dot" />
          {notice}
        </span>
        <div className="precise-seek">
          <NumberField
            label="이동 (초)"
            value={seconds(playState.timeUs)}
            min={0}
            max={seconds(Number.MAX_SAFE_INTEGER)}
            disabled={locked}
            onCommit={(n) => playback.seek(toUs(n))}
          />
        </div>
        <span>
          WEB CODECS <b>·</b> LOCAL FIRST
        </span>
      </footer>
      {modal === 'aiGen' && (
        <AiGenBoundary onCancel={() => setModal(undefined)}>
          <Suspense fallback={<AiGenPending onCancel={() => setModal(undefined)}/>}>
            <AiGenDialog project={project} lane={captionLane} registry={registry}
              onCancel={() => setModal(undefined)} onApply={applyAiGen}/>
          </Suspense>
        </AiGenBoundary>
      )}
      {modal === 'autoCaption' && (
        <AutoCaptionBoundary onCancel={() => setModal(undefined)}>
          <AutoCaptionDialog project={project} lane={captionLane} registry={registry}
            onCancel={() => setModal(undefined)} onApply={applyAutoCaption} />
        </AutoCaptionBoundary>
      )}
      {modal === 'autoCut' && (
        <AutoCutBoundary onCancel={() => setModal(undefined)}>
          <Suspense fallback={<AutoCutPending onCancel={() => setModal(undefined)} />}>
            <AutoCutDialog
              targetId={autoCutTarget!}
              project={project}
              registry={registry}
              onCancel={() => setModal(undefined)}
              onApply={applyAutoCut}
            />
          </Suspense>
        </AutoCutBoundary>
      )}
      {modal === 'export' && (
        <ExportDialog
          project={project}
          registry={registry}
          service={exporter}
          state={exportState}
          onClose={() => setModal(undefined)}
        />
      )}
      {modal === 'help' && <HelpDialog onClose={() => setModal(undefined)} />}
      {modal==='newProject'&&newProjectRequest&&<Dialog title="새 프로젝트 만들기" onClose={()=>{setModal(undefined);setNewProjectRequest(undefined);}}>
        <p>현재 프로젝트를 JSON으로 저장하거나, 저장하지 않고 새 프로젝트를 만들 수 있습니다. 원본 파일은 변경되지 않습니다.</p>
        {newProjectSaved&&<p role="status">JSON 다운로드를 요청했습니다. 파일이 저장됐는지 확인한 뒤 새 프로젝트 만들기를 선택하세요. 다운로드 취소/차단 여부는 자동으로 확인할 수 없습니다.</p>}
        {message&&<p className="inline-error" role="alert">{message}</p>}
        <footer className="dialog-footer project-start-actions">
          <button onClick={()=>{setModal(undefined);setNewProjectRequest(undefined);}}>취소</button>
          <button onClick={createProject}>{newProjectSaved?'새 프로젝트 만들기':'저장하지 않고 새로 만들기'}</button>
          <button className="primary" onClick={()=>{try{saveProject(newProjectRequest);setNewProjectSaved(true);setMessage(undefined);}catch(error){setMessage(error instanceof Error?error.message:String(error));}}}>{newProjectSaved?'다시 저장':'현재 프로젝트 저장'}</button>
        </footer>
      </Dialog>}
      {modal==='deleteAsset'&&deleteAssetRequest&&<Dialog title="사용 중인 에셋 삭제" onClose={()=>{setModal(undefined);setDeleteAssetRequest(undefined);}}>
        <p>이 에셋은 영상 블록 {deleteAssetRequest.count}개에서 사용 중입니다. 에셋을 지우면 해당 영상 블록도 타임라인에서 삭제됩니다. 계속하시겠습니까?</p>
        <p>합친 블록에 포함되어 있으면 그 블록 전체가 삭제됩니다. 다른 블록의 시간과 자막은 유지되며 실행 취소로 복구할 수 있습니다.</p>
        {message&&<p className="inline-error" role="alert">{message}</p>}
        <footer className="dialog-footer"><button onClick={()=>{setModal(undefined);setDeleteAssetRequest(undefined);}}>취소</button><button className="danger" onClick={confirmRemoveAsset}>확인 · 에셋 삭제</button></footer>
      </Dialog>}
      {modal === 'install' && (
        <InstallDialog result={installResult} onClose={() => setModal(undefined)} />
      )}
      {modal === 'deleteLane' && deleteLaneRequest && (
        <Dialog
          title={`라인 T${deleteLaneRequest.lane + 1} 삭제`}
          onClose={() => {
            setModal(undefined);
            setDeleteLaneRequest(undefined);
          }}
        >
          <p>
            이 라인에는 영상 블록 {deleteLaneRequest.videos}개, 자막 블록 {deleteLaneRequest.cues}
            개가 있습니다. 포함된 블록과 라인을 삭제하시겠습니까?
          </p>
          <p>다른 라인의 블록 시간은 유지되며 실행 취소로 복구할 수 있습니다.</p>
          {message && (
            <p className="inline-error" role="alert">
              {message}
            </p>
          )}
          <footer className="dialog-footer">
            <button
              onClick={() => {
                setModal(undefined);
                setDeleteLaneRequest(undefined);
              }}
            >
              취소
            </button>
            <button className="danger" onClick={confirmDeleteLane}>
              확인 · 라인 삭제
            </button>
          </footer>
        </Dialog>
      )}
      {modal === 'recover' && (
        <Dialog
          title="이전 편집을 복구할까요?"
          onClose={() => {
            setModal(undefined);
            setRecovery(undefined);
          }}
        >
          <p>
            이 브라우저에 저장한 프로젝트가 있습니다. 원본 영상은 포함되지 않으므로 파일을 다시
            연결해야 할 수 있습니다.
          </p>
          <strong>{recovery?.name}</strong>
          <footer className="dialog-footer">
            <button
              onClick={() => {
                setModal(undefined);
                setRecovery(undefined);
              }}
            >
              새로 시작
            </button>
            <button
              className="primary"
              onClick={() => {
                if (recovery) act({ type: 'load', project: recovery });
                setModal(undefined);
                setRecovery(undefined);
              }}
            >
              편집 복구
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
