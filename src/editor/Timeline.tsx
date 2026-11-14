import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react';
import {
  layout,
  laneCount,
  clipLane,
  cueLane,
  duration,
  timecode,
  seconds,
  toUs,
  type Project,
} from '../project/model';
import { trimAt, type Command } from '../project/commands';
import { ASSET_DRAG } from './AssetPanel';
import { PanelTitle } from './Panel';
import { SubtitleBlock } from './SubtitleBlock';
import { TimelineIcon } from './TimelineIcon';
import { VideoBlock } from './VideoBlock';
import { followPlayhead } from './timeline-scroll';
import type { BlockDragPreview } from './useBlockDrag';

type Props = {
  activeLane: number;
  onLaneChange: (lane: number) => void;
  onClearSelection: () => void;
  onDeleteLane: () => void;
  onMoveLane: (direction: -1 | 1) => void;
  project: Project;
  timeUs: number;
  selected?: string;
  selectedIds: string[];
  onMerge: () => void;
  selectedCue?: string;
  selectedCueIds: string[];
  locked: boolean;
  onSelect: (id: string, additive?: boolean, seek?: boolean) => void;
  onSelectCue: (id: string, additive?: boolean) => void;
  onSeek: (us: number) => void;
  onCommand: (command: Command) => void;
  onSplit: () => void;
  onDelete: () => void;
  onAutoCut: () => void;
  autoCutUnavailable?: string;
  onAutoCaption: () => void;
  autoCaptionUnavailable?: string;
  onAiGen: () => void;
  aiGenUnavailable?: string;
};
export function Timeline(p: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 1200 });
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const update = () => setViewport({ left: el.scrollLeft, width: el.clientWidth });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);
  const [zoom, setZoom] = useState(52);
  const [dragPreview, setDragPreview] = useState<BlockDragPreview>();
  const [trim, setTrim] = useState<{
    id: string;
    side: 'in' | 'out';
    startX: number;
    delta: number;
  }>();
  const blockDragging = useRef(false),
    suppressClick = useRef(false);
  const gestureChanged = (active: boolean, moved?: boolean) => {
    blockDragging.current = active;
    if (moved) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  };
  const rows = layout(p.project);
  const total = duration(p.project);
  const visibleSeconds = Math.max(16, seconds(Math.max(total, p.timeUs)) + 4);
  const width = Math.max(700, visibleSeconds * zoom);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || blockDragging.current || trim) return;
    const next = followPlayhead(
      72 + seconds(p.timeUs) * zoom,
      el.scrollLeft,
      el.clientWidth,
      el.scrollWidth,
    );
    if (next !== el.scrollLeft) el.scrollLeft = next;
  }, [p.timeUs, zoom, viewport.width]);
  const selectedClip = p.project.clips.find((c) => c.id === p.selected);
  const selectedLaneRows = selectedClip
    ? rows
        .filter((r) => clipLane(r.clip) === clipLane(selectedClip))
        .sort((a, b) => a.startUs - b.startUs)
    : [];
  const currentIndex = selectedLaneRows.findIndex((r) => r.clip.id === p.selected);
  const position = (e: { clientX: number }) => {
    const rect = scroll.current!.getBoundingClientRect();
    return Math.max(0, e.clientX - rect.left + scroll.current!.scrollLeft - 72);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (p.locked) return;
    const laneElement = (e.target as HTMLElement).closest<HTMLElement>('[data-lane]');
    if (!laneElement) return;
    const lane = Number(laneElement.dataset.lane);
    p.onLaneChange(lane);
    const assetId = e.dataTransfer.getData(ASSET_DRAG);
    if (!assetId) return;
    let timeUs = toUs(position(e) / zoom);
    const span = p.project.assets.find((a) => a.id === assetId)?.durationUs ?? 0;
    const edges = [
      0,
      ...rows.filter((r) => clipLane(r.clip) === lane).flatMap((r) => [r.startUs, r.endUs]),
      ...p.project.subtitles
        .filter((c) => cueLane(c) === lane)
        .flatMap((c) => [c.startUs, c.endUs]),
    ];
    const candidates = edges
      .flatMap((edge) => [edge, edge - span])
      .filter((t) => t >= 0)
      .sort((a, b) => Math.abs(a - timeUs) - Math.abs(b - timeUs));
    if (candidates.length && Math.abs(candidates[0] - timeUs) <= toUs(8 / zoom))
      timeUs = candidates[0];
    if (assetId) p.onCommand({ type: 'insert', assetId, index: rows.length, lane, timeUs });
  };
  const seekPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (p.locked || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    p.onSeek(toUs(position(e) / zoom));
  };
  const trimHandle = (id: string, side: 'in' | 'out') => (
    <button
      className={`trim-handle ${side}`}
      title={side === 'in' ? '시작 트림' : '끝 트림'}
      aria-label={side === 'in' ? '시작 트림 핸들' : '끝 트림 핸들'}
      disabled={p.locked}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setTrim({ id, side, startX: e.clientX, delta: 0 });
        p.onSelect(id);
      }}
      onPointerMove={(e) => {
        if (trim?.id === id && trim.side === side && e.currentTarget.hasPointerCapture(e.pointerId))
          setTrim({ ...trim, delta: toUs((e.clientX - trim.startX) / zoom) });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (trim?.id === id) {
          p.onCommand(trimAt(p.project, id, side, trim.delta));
          setTrim(undefined);
        }
      }}
      onPointerCancel={() => setTrim(undefined)}
      onDragStart={(e) => e.preventDefault()}
    >
      ‖
    </button>
  );
  const ticksStep = zoom < 30 ? 5 : zoom < 70 ? 2 : 1;
  const ticks = Array.from(
    { length: Math.ceil(viewport.width / zoom / ticksStep) + 2 },
    (_, i) => (Math.max(0, Math.floor((viewport.left - 72) / zoom / ticksStep)) + i) * ticksStep,
  ).filter((t) => t * zoom <= width);
  return (
    <section className="timeline-panel panel">
      <PanelTitle number="04" title="타임라인">
        <div className="timeline-tools" role="toolbar" aria-label="타임라인 도구">
          <div className="timeline-tool-group" role="group" aria-label="라인 조작">
            <button
              aria-label="라인 추가"
              disabled={p.locked || laneCount(p.project) >= 32}
              onClick={() => {
                p.onCommand({ type: 'addLane' });
                p.onLaneChange(laneCount(p.project));
              }}
            >
              <TimelineIcon name="add" />
              라인 추가
            </button>
            <button disabled={p.locked} onClick={p.onDeleteLane}>
              <TimelineIcon name="trash" />
              라인 삭제
            </button>
            <button
              aria-label="라인 위"
              disabled={p.locked || p.activeLane <= 0}
              onClick={() => p.onMoveLane(-1)}
            >
              <TimelineIcon name="up" />
              라인 위
            </button>
            <button
              aria-label="라인 아래"
              disabled={p.locked || p.activeLane >= laneCount(p.project) - 1}
              onClick={() => p.onMoveLane(1)}
            >
              <TimelineIcon name="down" />
              라인 아래
            </button>
          </div>
          <div className="timeline-tool-group" role="group" aria-label="블록 조작">
            <button
              disabled={p.locked || !duration(p.project)}
              onClick={p.onSplit}
              title="재생 위치에서 블록 분할 (1 / S)"
            >
              <TimelineIcon name="split" />
              블록 분할
            </button>
            <button
              disabled={p.locked || (!p.selected && !p.selectedCueIds.length)}
              onClick={p.onDelete}
              title="선택 블록 삭제 (2 / Delete)"
            >
              <TimelineIcon name="trash" />
              블록 삭제
            </button>
            <button
              disabled={p.locked || p.selectedIds.length < 2 || p.selectedCueIds.length > 0}
              onClick={p.onMerge}
            >
              <TimelineIcon name="merge" />
              블록 합치기
            </button>
            <button
              aria-label="블록 왼쪽"
              disabled={p.locked || currentIndex <= 0}
              onClick={() =>
                p.onCommand({
                  type: 'move',
                  id: p.selected!,
                  index: p.project.clips.findIndex((c) => c.id === p.selected) - 1,
                })
              }
            >
              <TimelineIcon name="left" />
              블록 왼쪽
            </button>
            <button
              aria-label="블록 오른쪽"
              disabled={p.locked || currentIndex < 0 || currentIndex >= selectedLaneRows.length - 1}
              onClick={() =>
                p.onCommand({
                  type: 'move',
                  id: p.selected!,
                  index: p.project.clips.findIndex((c) => c.id === p.selected) + 1,
                })
              }
            >
              <TimelineIcon name="right" />
              블록 오른쪽
            </button>
          </div>
          <div className="timeline-tool-group" role="group" aria-label="확장 기능">
            <button
              disabled={p.locked || !!p.autoCutUnavailable}
              title={p.autoCutUnavailable ?? '선택 영상 블록 음성 분석'}
              onClick={p.onAutoCut}
            >
              <TimelineIcon name="auto" />
              AUTO CUT
            </button>
            <button disabled={p.locked || !!p.autoCaptionUnavailable}
              title={p.autoCaptionUnavailable ?? '선택 라인 음성 구간에 빈 자막 생성'}
              onClick={p.onAutoCaption}>
              <TimelineIcon name="auto" />
              AUTO CAPTION
            </button>
            <button disabled={p.locked || !!p.aiGenUnavailable} title={p.aiGenUnavailable ?? 'AI Gen 자동 자막 생성'} onClick={p.onAiGen}>
              <TimelineIcon name="auto" />AI Gen
            </button>
          </div>
        </div>
        <label className="zoom-control">
          −
          <input
            aria-label="타임라인 확대"
            type="range"
            min={16}
            max={150}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          ＋
        </label>
      </PanelTitle>
      <div
        className="timeline-scroll"
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onClick={(e) => {
          if (p.locked) return;
          const target = e.target as HTMLElement;
          if (!target.closest('.timeline-clip,.subtitle-block,button,input,.ruler'))
            p.onClearSelection();
        }}
        ref={scroll}
        onScroll={(e) =>
          setViewport({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })
        }
        onDragOver={(e) => {
          if (!p.locked && e.dataTransfer.types.includes(ASSET_DRAG)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={onDrop}
      >
        <div className="timeline-content" style={{ width: width + 72 }}>
          <div
            className="ruler"
            style={{ width }}
            onPointerDown={seekPointer}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                p.onSeek(toUs(position(e) / zoom));
            }}
          >
            {ticks.map((t) => (
              <span key={t} style={{ left: t * zoom }}>
                {timecode(toUs(t), p.project.fps).slice(0, -3)}
              </span>
            ))}
            <div className="playhead-grip" style={{ left: seconds(p.timeUs) * zoom }} />
          </div>
          {Array.from({ length: laneCount(p.project) }, (_, lane) => (
            <div
              className={`timeline-row ${p.activeLane === lane ? 'active' : ''}`}
              data-lane={lane}
              key={lane}
              onClick={() => !p.locked && p.onLaneChange(lane)}
            >
              <button
                className="lane-label"
                disabled={p.locked}
                aria-pressed={p.activeLane === lane}
                onClick={() => p.onLaneChange(lane)}
              >
                T{lane + 1}
              </button>
              <div className="track-bed" style={{ width }}>
                {rows.map(({ clip, startUs, endUs }, index) => {
                  if (clipLane(clip) !== lane) return null;
                  return (
                    <VideoBlock
                      dragPreview={dragPreview}
                      onDragPreview={setDragPreview}
                      key={clip.id}
                      project={p.project}
                      clip={clip}
                      startUs={startUs}
                      endUs={endUs}
                      index={index}
                      zoom={zoom}
                      locked={p.locked}
                      selectedIds={p.selectedIds}
                      selectedCueIds={p.selectedCueIds}
                      onSelect={p.onSelect}
                      onSeek={p.onSeek}
                      onLaneChange={p.onLaneChange}
                      onCommand={p.onCommand}
                      onGestureChange={gestureChanged}
                      handles={
                        p.selectedIds.length < 2 ? (
                          <>
                            {trimHandle(clip.id, 'in')}
                            {trimHandle(clip.id, 'out')}
                          </>
                        ) : null
                      }
                    />
                  );
                })}
                {!rows.some((r) => clipLane(r.clip) === lane) &&
                  !p.project.subtitles.some((c) => cueLane(c) === lane) && (
                    <div className="timeline-empty">영상 또는 자막을 이 행에 배치하세요</div>
                  )}
                {p.project.subtitles
                  .filter((c) => cueLane(c) === lane)
                  .map((c) => (
                    <SubtitleBlock
                      selectedIds={[...p.selectedIds, ...p.selectedCueIds]}
                      dragPreview={dragPreview}
                      onDragPreview={setDragPreview}
                      onGestureChange={gestureChanged}
                      key={c.id}
                      onLaneChange={p.onLaneChange}
                      project={p.project}
                      cue={c}
                      selected={p.selectedCueIds.includes(c.id)}
                      multiple={p.selectedCueIds.length > 1}
                      locked={p.locked}
                      zoom={zoom}
                      onSelect={p.onSelectCue}
                      onCommand={p.onCommand}
                    />
                  ))}
                <div className="playhead-line" style={{ left: seconds(p.timeUs) * zoom }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <footer className="timeline-footer">
        <span>{rows.length} 클립</span>
        <label>
          재생 위치{' '}
          <input
            aria-label="재생 위치"
            type="range"
            min={0}
            max={Math.max(1, total, p.timeUs)}
            step={1}
            value={p.timeUs}
            disabled={p.locked}
            onChange={(e) => p.onSeek(Number(e.target.value))}
          />
        </label>
        {trim && <span>트림 {seconds(trim.delta).toFixed(2)}초</span>}
      </footer>
    </section>
  );
}
