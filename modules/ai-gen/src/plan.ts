import {
  clipLane,
  laneCount,
  mediaLayout,
  newId,
  type Cue,
  type Project,
} from '../../../src/project/model';
import { parseProject } from '../../../src/project/validation';
import type { MediaRegistry } from '../../../src/media/registry';
import { LIMITS } from '../../ai-api/shared/contracts';
export type Segment = {
  id: string;
  assetId: string;
  inUs: number;
  outUs: number;
  startUs: number;
  endUs: number;
};
export type Draft = {
  segment: Segment;
  text: string;
  state: 'pending' | 'success' | 'failed';
  error?: string;
};
export function scopeFor(project: Project, lane: number): Project {
  return {
    ...project,
    clips: mediaLayout(project)
      .filter(
        (row) =>
          clipLane(row.clip) === lane &&
          !row.clip.muted &&
          project.assets.find((a) => a.id === row.clip.assetId)?.hasAudio,
      )
      .map((row) => ({ ...row.clip, startUs: row.startUs })),
    subtitles: [],
  };
}
export function unavailable(project: Project, registry: MediaRegistry, lane: number) {
  if (
    !globalThis.isSecureContext ||
    typeof AudioDecoder !== 'function' ||
    typeof Worker !== 'function'
  )
    return 'HTTPS 및 WebCodecs 지원 환경이 필요합니다.';
  const scope = scopeFor(project, lane);
  if (!scope.clips.length) return '선택 라인에 음소거되지 않은 오디오 포함 영상이 필요합니다.';
  if (scope.clips.some((c) => !registry.has(c.assetId))) return '누락된 원본을 다시 연결하세요.';
  if (laneCount(project) >= 32) return '새 자막 라인을 위한 공간이 필요합니다. 최대 32라인입니다.';
  return undefined;
}
export function segmentsFor(
  scope: Project,
  ranges: { startUs: number; endUs: number }[],
): Segment[] {
  const result: Segment[] = [];
  const rows = mediaLayout(scope);
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.startUs) ||
      !Number.isSafeInteger(range.endUs) ||
      range.endUs <= range.startUs
    )
      throw new Error('음성 구간 시간이 올바르지 않습니다.');
    for (const row of rows) {
      const end = Math.min(range.endUs, row.endUs);
      for (let start = Math.max(range.startUs, row.startUs); start < end;) {
        const stop = Math.min(end, start + 15_000_000);
        result.push({
          id: newId(),
          assetId: row.clip.assetId,
          startUs: start,
          endUs: stop,
          inUs: row.clip.inUs + start - row.startUs,
          outUs: row.clip.inUs + stop - row.startUs,
        });
        if (result.length > LIMITS.maxSegments)
          throw new Error('음성 구간이 1000개를 초과했습니다. 작업을 나누어 주세요.');
        start = stop;
      }
    }
  }
  return result.sort((a, b) => a.startUs - b.startUs);
}
export function buildResult(project: Project, drafts: Draft[]): Project {
  if (drafts.some((d) => d.state !== 'success'))
    throw new Error('모든 구간의 전사가 끝나야 적용할 수 있습니다.');
  const sourceRows = mediaLayout(project);
  for (const { segment: s } of drafts) {
    if (
      ![s.startUs, s.endUs, s.inUs, s.outUs].every(Number.isSafeInteger) ||
      !sourceRows.some(
        (row) =>
          row.clip.assetId === s.assetId &&
          s.startUs >= row.startUs &&
          s.endUs <= row.endUs &&
          s.endUs > s.startUs &&
          s.inUs === row.clip.inUs + s.startUs - row.startUs &&
          s.outUs === s.inUs + s.endUs - s.startUs,
      )
    )
      throw new Error('자막 구간이 원본 영상 범위를 벗어났습니다.');
  }
  const lane = laneCount(project);
  const cues: Cue[] = drafts
    .filter((d) => d.text.trim())
    .map(({ segment: s, text }) => {
      if (
        text.length > 2000 ||
        !Number.isSafeInteger(s.startUs) ||
        !Number.isSafeInteger(s.endUs) ||
        s.startUs < 0 ||
        s.endUs <= s.startUs
      )
        throw new Error('자막 시간 또는 텍스트 길이가 올바르지 않습니다.');
      return {
        id: newId(),
        lane,
        startUs: s.startUs,
        endUs: s.endUs,
        text: text.trim(),
        size: 0.05,
        color: '#ffffff',
        background: '#000000',
        x: 0.5,
        y: 0.9,
      };
    });
  if (!cues.length) return project;
  if (lane >= 32 || cues.length > LIMITS.maxSegments)
    throw new Error('자막 또는 라인 수 한도를 초과했습니다.');
  return parseProject(
    JSON.stringify({ ...project, laneCount: lane + 1, subtitles: [...project.subtitles, ...cues] }),
  );
}
