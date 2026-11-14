# Devianns Clip Maker Plus 상세 설계

## Plus AI 변경 기록

Plus 브랜치는 기본 편집을 유지하면서 `modules/ai-gen`(모달·음성 준비·자막 계획)과 `modules/ai-api`(공용 호출·서버·공급자 어댑터)를 추가한다. 사용자가 AI Gen의 외부 전송 안내를 확인하고 실행할 때만 짧은 음성을 서버와 공급자로 전송한다. 키는 서버 환경변수로만 관리한다. 최종 완료까지 프로젝트를 수정하지 않고 새 자막 라인을 한 번의 히스토리 명령으로 적용한다.

일반 서버와 서버리스는 표준 Request/Response 처리 함수를 공유한다. Vercel 진입점은 별도 어댑터이며 핵심 로직에는 플랫폼 SDK가 없다. 서버리스 운영의 인증·공유 요청 제한이 없으면 실패하도록 구성했다. 구체 계약과 진행 상태는 [AI 체크리스트](./docs/plus/clip_maker_plus_ai_checklist_v1.md), [실행·배포](./docs/plus/AI_GEN_DEPLOY.md)를 따른다.

최소 실제 API 호출은 공급자 HTTP 402로 종료되어 성공적인 음성 전사는 미확인이다. 브라우저·실제 편집기 검증은 사용자 요청으로 생략한다. 아래 기존 정적 전용·비전송 설계는 기본 로컬 편집에 해당하며 Plus의 명시적 AI 요청에는 위 예외가 우선한다.

설계 기준일: 2026-11-14 · 상태: 첫 편집기 구현 · 문서 버전: 2

이 문서는 정적 호스팅에서 실행되는 로컬 영상 편집기의 구현 기준이다. 기술 선택과 동작 계약은 아래와 같이 정한다. 코덱 지원, 성능, 라이브러리의 구체 API는 실제 구현 환경에서 검증한다. 현재 저장소에는 첫 편집기와 검사 도구가 있으며 실제 Windows Edge 검증 결과는 IMPLEMENTATION.md에 기록한다. 공개 GitHub Pages 배포는 아직 검증하지 않았다.

## 1. 목표와 경계

- GitHub Pages에 빌드 결과만 배포한다. 런타임 백엔드, 서버리스 인코딩, 영상 업로드 API를 요구하지 않는다.
- 사용자가 선택한 로컬 영상으로 컷 편집, 미리보기, 수동 자막, 영상 내보내기를 수행한다.
- 파일·프레임·음성·자막을 외부로 보내지 않는다. 기본 구성에는 분석 SDK, 외부 폰트, 런타임 CDN 의존성을 넣지 않는다.
- 서버 영상 처리 비용은 발생하지 않지만 호스팅 이용 한도와 사용자 기기의 연산·저장 공간 한계는 존재한다.
- 브라우저 내부 실행이 모든 코덱 지원, 하드웨어 가속, 네이티브 앱 수준 성능 또는 라이선스 면제를 보장하지 않는다.

정적 호스팅과 정적 화면은 다르다. 호스트가 전달한 JavaScript가 사용자 기기에서 편집기를 실행한다. SSG 프레임워크는 필수 조건이 아니다.[S1][S2]

## 2. 출시 범위

### MVP 필수 기능

| 구분 | 동작 계약 |
| --- | --- |
| 입력 | 로컬 파일 선택·드롭, 메타데이터·디코딩 가능 여부 검사. MP4/H.264/AAC를 우선 검증 |
| 타임라인 | 영상 트랙 1개, 클립 여러 개. 앞뒤 트림, 분할, 삭제, 순서 변경. 빈틈 없이 이어지는 ripple 방식 |
| 미리보기 | 재생·정지·시킹, 재생 위치 표시, 출력 프레임 단위 이동, 원본 소리 재생 |
| 자막 | 프로젝트 시간 기준 입력·수정·삭제, 시작·종료, 위치·크기·색상·배경·외곽선, 한글·줄바꿈 |
| 화면 | 16:9·9:16·1:1 프리셋. 기본 contain 및 검은 배경, 선택적 cover·크롭·위치 조정 |
| 오디오 | 영상에 포함된 첫 오디오 트랙, 클립별 음소거·고정 볼륨. 무음 영상 지원 |
| 내보내기 | 지원 확인 후 MP4/H.264/AAC 우선 제공. 지원되는 환경에서 WebM/VP9 또는 VP8 + Opus 대안 제공 |
| 편집 상태 | 실행 취소·다시 실행, 프로젝트 JSON 다운로드·불러오기, IndexedDB 자동 저장 |
| 작업 제어 | 진행률·취소·오류·재시도, 원본 누락 시 재연결 |

자막은 MVP에서 영상에 구워 넣는다. 자막 트랙은 여러 cue를 담지만 동시에 겹치는 cue는 허용하지 않으며 입력 시 충돌을 알려준다. 원본의 여러 비디오·오디오 트랙을 자동 혼합하지 않는다.

### 후속 기능

SRT 가져오기·내보내기(스타일 보존은 제외), 별도 BGM 트랙·페이드, 파형, 프록시 생성, 다중 영상 레이어, 전환 효과, 배속, 자동 자막은 후속 범위다. 자동 자막은 로컬 추론 모델의 다운로드 크기·지원 기기·성능 검증이 별도로 필요하다. 무손실 smart cut, HDR 출력, 4K/장시간 편집, 모바일 전체 지원, 협업·클라우드 저장은 MVP에 포함하지 않는다.

초기 설계 목표는 데스크톱 Chrome·Edge, SDR, 최대 1920×1080 또는 1080×1920, 30fps, 프로젝트 5분 이하다. 이는 검증된 처리 보장이 아니다. 세로형은 긴 변 1920, 짧은 변 1080 이하로 제한한다. 입력 파일 크기만으로 지원을 판정하지 않고 해상도·코덱·길이·출력 예상 크기를 함께 확인한다.

## 3. 기술 결정

| 영역 | 결정 | 이유 |
| --- | --- | --- |
| 앱 | TypeScript strict + Vite + React | 정적 빌드, UI와 미디어 엔진 분리 |
| 의존성 관리 | npm + package-lock.json | 재현 가능한 설치. 버전은 구현 시작 시 호환 조합을 선택하고 잠금 |
| 미디어 입출력 | Mediabunny 어댑터 | 컨테이너 파싱·작성과 샘플 접근을 한 계층으로 격리 |
| 코덱 | WebCodecs | 영상·오디오 디코딩 및 인코딩 |
| 합성 | Canvas 2D, 가능하면 Worker의 OffscreenCanvas | 영상·자막·좌표 계산 공유. WebGL/WebGPU는 측정 후 도입 |
| 미리보기 오디오 | Web Audio API | 사용자 제스처로 시작, 오디오 시계를 재생 기준으로 사용 |
| 내보내기 오디오 | 블록 단위 PCM 처리·리샘플링 어댑터 | 실시간 재생 속도와 분리된 출력 |
| 영속 상태 | IndexedDB + 버전 있는 JSON | 자동 복구와 파일로 이동 가능한 프로젝트 |
| 임시 대용량 데이터 | 선택적 OPFS | 지원·할당량 확인 후 사용. 필수 전제는 아님 |
| 검사 | Vitest + 실제 브라우저 통합 검사, 필요 시 Playwright | 순수 편집 로직과 실제 미디어 처리를 각각 검증 |

`mp4-muxer`는 유지보수 종료로 신규 도입하지 않는다.[S3] `mp4box.js`는 필요 시 비교 대상이며 기본 구성에 중복 도입하지 않는다. Mediabunny도 브라우저 코덱 지원을 만들어 주지는 않는다.[S4]

FFmpeg.wasm 및 WASM 코덱은 기본 의존성이 아니다. 특히 다중 스레드 WASM은 SharedArrayBuffer와 격리 조건을 요구할 수 있다. GitHub Pages 기본 배포에서 임의 COOP/COEP 헤더 설정을 전제로 삼지 않는다. WebCodecs + 일반 Dedicated Worker + transferable 객체 경로는 SharedArrayBuffer를 요구하지 않도록 작성한다.[S2][S8][S9]

## 4. 전체 구성과 데이터 흐름

```text
GitHub Pages: HTML / CSS / JS / Worker / 로컬 배포 폰트
                            ↓
                    Editor UI (main thread)
                            ↓ commands
                  ProjectStore / History
                            ↓ immutable snapshot
              Timeline resolver + Render specification
                   ↙                        ↘
          Playback controller           Export controller
             ↓       ↓                       ↓
    Decode Worker   Web Audio          Export Worker
             ↓       ↓              Demux → Decode → Compose
         Canvas + speakers           → Encode → Mux → OutputTarget
                                                ↓
                                       파일 저장 / 다운로드

Local File → Media adapter → metadata / packet index / bounded sample access
Storage adapter ↔ project JSON / IndexedDB / optional OPFS
```

UI는 코덱이나 muxer를 직접 호출하지 않는다. 미디어 어댑터는 React와 프로젝트 UI에 의존하지 않는다. 라이브러리 객체를 프로젝트 JSON에 저장하지 않는다. 미리보기와 내보내기는 동일한 타임라인 해석·자막 레이아웃·좌표 변환을 사용한다. 장치별 디코딩·캔버스 차이 때문에 픽셀 단위 동일성은 보장하지 않는다.

## 5. 프로젝트 데이터 계약

아래는 최초 모델의 개념 설명이며 실제 직렬화 타입은 src/project/model.ts 및 프로젝트 검증기가 기준이다. 21절에 구현 명칭과 차이를 기록한다. 실제 라이브러리 API를 뜻하지 않는다.

```ts
type Us = number; // 정수 마이크로초, 안전한 정수 범위 검사

type Asset = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  durationUs: Us;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  videoCodec: string;
  audioCodec?: string;
  fingerprint?: string; // 선택적 부분 해시. 동일성의 완전한 증명은 아님
};

type Clip = {
  id: string;
  assetId: string;
  inUs: Us;
  outUs: Us; // exclusive
  muted: boolean;
  gain: number; // 0..2, 초기값 1
  transform: {
    fit: 'contain' | 'cover';
    scale: number; // 0보다 큼
    offsetX: number; // 출력 너비에 대한 비율
    offsetY: number; // 출력 높이에 대한 비율
  };
};

type SubtitleCue = {
  id: string;
  startUs: Us;
  endUs: Us; // exclusive, 프로젝트 시간
  text: string; // HTML이 아닌 plain text
  style: {
    fontId: string;
    fontSizeRatio: number; // 출력 높이 기준
    color: string;
    backgroundColor: string;
    outlineColor: string;
    outlineWidthRatio: number;
    anchorX: number; // 0..1
    anchorY: number; // 0..1
    align: 'left' | 'center' | 'right';
  };
};

type Project = {
  schemaVersion: 1;
  id: string;
  name: string;
  output: {
    width: number;
    height: number;
    fps: { numerator: number; denominator: number }; // MVP 30/1
    backgroundColor: string;
    sampleRate: 48000;
    channels: 2;
  };
  assets: Asset[];
  clips: Clip[]; // 배열 순서가 재생 순서
  subtitles: SubtitleCue[];
};
```

File, object URL, 파일 핸들, VideoFrame, AudioData, 디코더는 별도의 런타임 레지스트리에서 assetId로 연결한다. 스크럽 위치·선택·드래그 상태와 내보내기 진행률은 프로젝트의 영속 편집 데이터와 분리한다.

모든 구간은 `[start, end)`이다. 클립은 `0 ≤ sourceIn < sourceOut ≤ asset.duration`을 만족해야 한다. 타임라인 시작은 앞 클립 길이 합으로 계산하며 이 값을 중복 저장하지 않는다. 속도는 MVP에서 1배로 고정한다.

```text
clipDuration = outUs - inUs
sourceTime = inUs + (projectTime - clipTimelineStartUs)
outputFrameTimeUs(n) = round(n × 1_000_000 × fps.denominator / fps.numerator)
```

입력 VFR은 실제 presentation timestamp로 처리한다. 출력은 CFR이다. 부동소수점 프레임 시간을 반복 누적하지 않는다. 마지막 출력 프레임의 표시 길이는 프로젝트 끝으로 제한하고 음성 샘플 수의 반올림도 같은 프로젝트 끝을 기준으로 계산한다.

### 편집 명령과 자막 규칙

- trim/split/delete/reorder/transform/subtitle 명령을 reducer 또는 동등한 순수 함수로 처리한다. 드래그 한 번을 undo 한 번으로 묶는다.
- 분할은 원본을 복사하지 않고 두 구간을 만든다. 양쪽 중 길이가 0인 분할은 거부한다.
- 자막은 프로젝트 시간에 고정한다. 클립 재배열·트림 시 자막을 자동으로 원본에 따라 이동시키지 않는다. UI에 이 규칙을 명시한다.
- 길이 변경으로 끝을 넘은 cue는 자동 삭제하지 않는다. 범위 밖 경고를 표시하고 수정 전 내보내기를 막는다.
- 편집 이력은 최대 100개 명령으로 제한한다. 대용량 미디어는 이력에 포함하지 않는다.

## 6. 입력과 지원 여부 판단

1. 사용자의 파일 선택으로만 File 접근을 시작한다. 확장자/MIME만 신뢰하지 않고 컨테이너·트랙을 분석한다.
2. 첫 영상 트랙과 첫 오디오 트랙을 선택하고 나머지는 미사용으로 안내한다. 영상 트랙이 없으면 MVP 입력을 거부한다.
3. 원본 codec description, 시간 기준, 회전, 표시 크기를 읽는다. 손상 파일·암호화/DRM·지원하지 않는 HDR/색 특성은 원인을 구분해 안내한다.
4. `VideoDecoder`/`AudioDecoder` 존재와 실제 트랙 설정 지원을 확인한다. 실제 샘플 디코딩 실패도 처리한다.
5. 필요한 바이트만 읽는 File/Blob 기반 source를 사용한다. 영상 전체 `arrayBuffer()`와 전체 PCM 디코딩을 기본 경로로 사용하지 않는다.[S5]
6. 썸네일을 낮은 우선순위로 생성하고 캐시 상한을 적용한다. 입력 회전은 합성 전에 정규화한다.

`<video>` 재생 가능 여부와 WebCodecs 디코딩/인코딩 가능 여부를 동일하게 취급하지 않는다. WebCodecs 사용에는 보안 컨텍스트가 필요하므로 HTTPS 배포와 localhost 개발 서버를 사용한다.[S2]

## 7. 미리보기와 탐색

### 기본 경로

전체 편집 미리보기는 Worker 디코딩 + Canvas 합성 + Web Audio로 구현한다. `<video>`는 원본 확인이나 기술 검증용 보조 플레이어로만 쓴다. `<video>.currentTime` 이동과 실시간 녹화를 최종 내보내기 엔진으로 사용하지 않는다.

### 재생

- 사용자 재생 동작에서 AudioContext를 resume한다. 오디오가 있는 경우 AudioContext 시간과 시작 프로젝트 시간을 연결한다.
- 디코딩한 PCM을 제한된 길이로 미리 준비하고 AudioBufferSourceNode로 일정에 맞춰 재생한다. AudioData는 Web Audio로 직접 전달하지 않고 PCM/AudioBuffer로 변환한다.
- 오디오 없는 프로젝트는 monotonic clock을 쓴다. RAF는 화면 갱신 트리거이며 영상 시간의 원천이 아니다.
- 영상 프레임이 늦으면 오래된 표시 프레임을 건너뛸 수 있다. 오디오 준비가 끊기면 프로젝트 시간을 정지시키고 buffering 후 새 기준점으로 재개한다.
- 정지·시킹·클립 변경 시 예약한 소스를 stop/disconnect하고 시계 기준을 갱신한다. 경계 이전 오디오가 남지 않도록 한다.
- 탭이 숨겨지면 MVP는 재생을 일시 정지한다. 실시간 재생 품질과 오프라인 출력 속도를 구분한다.

### 시킹

입력 timestamp와 키프레임 인덱스를 사용한다. 목표 이전의 디코딩 가능한 키프레임부터 decode order로 공급하고, 목표 presentation time을 포함하는 프레임을 선택한다. B-frame의 decode order와 표시 순서를 혼동하지 않는다.

시킹 요청에는 증가하는 generation ID를 부여한다. 새 요청이 오면 이전 작업을 무효화하며, 오래된 결과 프레임은 즉시 close한다. 스크럽 중 모든 요청을 실행하지 않고 최신 요청으로 합친다. 정지 상태에서는 요청한 출력 프레임 시점으로 정밀 탐색한다.

## 8. 영상·자막 합성

렌더러는 `(project snapshot, projectTimeUs, source frame, output size)`를 받아 한 장을 그리는 순수한 레이아웃 계산과 Canvas 실행부로 나눈다.

합성 순서는 배경 → 회전 정규화 → contain/cover·scale·offset → 자막 배경 → 외곽선 → 글자다. 미리보기 CSS 크기나 devicePixelRatio를 출력 영상 크기에 섞지 않는다. 미리보기는 출력 좌표계를 축소해 표시한다.

한글을 포함하는 재배포 가능한 폰트를 앱에 묶고 라이선스 고지를 보관한다. 미리보기와 Worker 각각에서 폰트 로딩 완료를 기다린 후 렌더링한다. 로드 실패 시 조용히 다른 폰트로 출력하지 않고 재시도나 명시적인 대체 선택을 제공한다.

자막은 개행과 한글 줄바꿈을 처리하며 출력 폭 90% 안에서 줄을 나눈다. 기본 위치는 하단 안전 여백 5%, 가운데 정렬이다. 텍스트를 innerHTML로 삽입하지 않는다. 스타일 값·글자 수·프로젝트 JSON 크기는 입력 경계에서 검증한다. 이모지 등 폰트별 재현성이 다른 글리프는 검증 목록에 포함한다.

## 9. 오디오 처리

출력은 48kHz stereo로 정규화한다. mono는 양 채널에 매핑하고 다채널은 MVP에서 명시적으로 거부한다. 원본이 무음이면 프로젝트 출력도 무음으로 처리하며, 모든 클립이 무음이면 오디오 트랙을 생략할 수 있다.

프로젝트 시간을 출력 샘플 인덱스로 변환해 원본 구간을 자른다. 입력 sample rate가 다르면 상태를 유지하는 스트리밍 리샘플러를 사용하며, 연속 처리 블록마다 위상을 초기화하지 않는다. lib/자체 구현 선택은 1단계에서 품질·속도 검증 후 어댑터 안에 고정한다. 전체 길이 OfflineAudioContext는 기본 경로가 아니다.

클립별 gain·mute를 적용하고 최종 PCM은 [-1, 1]로 제한한다. 컷 경계에 생길 수 있는 클릭음은 검증하며, 숨은 자동 crossfade는 넣지 않는다. 디코더의 시작 timestamp, codec delay, encoder priming/padding은 미디어 어댑터와 muxer가 처리하는 범위를 검증한다. 정확한 컷과 미리보기 일관성을 위해 MVP는 오디오도 재인코딩한다.

## 10. 내보내기

### 지원 협상

내보내기 화면 진입 시 해상도·FPS·비트레이트·오디오 설정을 포함해 각 후보를 확인한다. 완전한 codec string을 사용하며 라이브러리 유틸 또는 `isConfigSupported()`를 어댑터에서 호출한다. API 존재만으로 활성화하지 않는다.[S4][S7]

1. MP4 + H.264 + AAC를 우선 제안한다. AAC가 필요 없는 무음 프로젝트는 오디오 인코더를 요구하지 않는다.
2. 지원되지 않으면 WebM + VP9/Opus, 다음 VP8/Opus를 실제 지원 확인 후 제안한다.
3. 대체 형식은 사용자에게 확장자·호환성 차이를 알리고 선택받는다. 자동으로 무음 출력하거나 확장자만 바꾸지 않는다.
4. 어느 조합도 안 되면 출력 비활성화와 환경 안내를 제공한다. 해상도를 낮춰도 코덱 부재 자체가 해결된다고 가정하지 않는다.

초기 비트레이트 기본값은 1080p 영상 8Mbps, 720p 5Mbps, 오디오 128kbps다. H.264 profile/level은 출력 크기·FPS에 맞춰 선택한다. 하드웨어 가속 요청은 힌트이며 성공 보장이 아니다.

### 처리 순서

1. 프로젝트 스냅샷·원본 연결·자막 범위·코덱·저장 경로를 검증한다. 출력 도중 편집은 MVP에서 잠근다.
2. 실시간 시계와 무관하게 출력 프레임 n의 timestamp를 계산한다.
3. 해당 클립의 원본 프레임을 선택·합성하고, timestamp와 duration을 가진 VideoFrame으로 인코더에 전달한다.
4. 오디오는 고정 크기 블록으로 처리하고 샘플 인덱스로 timestamp를 계산한다. 영상·오디오를 작은 시간 창으로 번갈아 공급해 한 트랙 전체가 메모리에 쌓이지 않게 한다.
5. 출력 chunk와 codec metadata를 muxer에 전달한다. 타임라인은 0에서 시작하며 트랙 간 기준점을 공유한다.
6. 인코더 flush → muxer finalize → 저장 완료 순으로 진행한다. 100% 표시는 파일 작성 완료 뒤에만 한다.
7. 성공·실패·취소 모두 디코더·인코더·프레임·오디오·임시 파일을 정리한다.

MP4의 최종 메타데이터 작성에 필요한 seek/random-access 조건은 OutputTarget과 함께 검증한다. 임의의 WritableStream이 모든 muxer 출력 모드에 호환된다고 가정하지 않는다.[S6]

### 저장 경로

지원되는 브라우저에서는 사용자 동작 중 파일 저장 핸들을 먼저 얻고, 검증된 출력 어댑터를 통해 디스크에 쓴다. 선택 취소는 정상 취소다. 대안은 OPFS 임시 출력 후 저장 또는 크기 제한이 있는 메모리 Blob 다운로드다.

메모리 출력의 초기 상한은 예상 크기 256MiB다. `(video bitrate + audio bitrate) × duration / 8`에 20% 여유를 두고 사전 계산하며, 실제 누적 크기도 검사한다. 상한을 넘으면 해상도/길이 변경 또는 디스크 저장을 안내한다. 이 값이 브라우저의 안전한 메모리 총량을 보장하지는 않는다. OPFS도 할당량·퇴거 가능성을 가진다.[S10]

취소 시 부분 파일을 완성 파일로 표시하지 않는다. 직접 저장한 부분 파일이 남으면 사용자에게 위치와 삭제 필요성을 알리고, 앱 소유 임시 파일은 제거한다.

## 11. Worker 계약·상태·메모리

### 메시지

요청은 `{ requestId, generation, type, payload }`, 응답은 동일 ID와 `result | progress | error | cancelled`를 갖는다. 주요 요청은 inspect/seek/startExport/cancel/dispose다. 프로젝트 메시지는 직렬화 가능한 DTO만 사용한다.

원본 File/Blob은 clone 가능한 형태로 전달하고, VideoFrame/ArrayBuffer는 가능한 경우 transfer한다. transfer 후 송신 측은 소유권을 잃은 것으로 취급한다. 수신 측이 close 책임을 가진다. 실제 Mediabunny 샘플 객체는 별도 어댑터에서 수명 규칙을 준수한다.

### 상태

```text
editor: empty → importing → ready ↔ playing / seeking
export: idle → preparing → rendering → finalizing → completed
                         ↘ cancelling → cancelled
각 작업 상태 → failed (원인·재시도 가능 여부 포함)
```

파일 가져오기·내보내기 오류를 프로젝트 손상과 구분한다. Worker 종료·디코더 오류·저장 실패 후에도 마지막 유효 프로젝트 상태를 유지한다. 오류 DTO에는 code, stage, assetId?, message, recoverable을 담으며 사용자 파일 내용이나 자막을 콘솔/네트워크 로그로 자동 기록하지 않는다.

### 초기 자원 예산

- 동시에 처리하는 내보내기는 1개. 미리보기 디코더와 썸네일 작업은 내보내기 중 정지·해제한다.
- 영상 디코딩/인코딩 큐는 각각 초기 high-water mark 8개를 목표로 하고 dequeue 및 downstream 소비를 기다린다.
- 별도 프레임 캐시는 최대 8장 또는 추정 64MiB 중 먼저 도달하는 값으로 제한한다. 개수·추정 바이트를 추적한다.
- 미리보기 PCM 미리 읽기는 최대 2초, 내보내기 PCM 블록은 초기 4096 samples/channel을 사용한다.
- 썸네일 캐시는 최대 200개·추정 32MiB, 이력에는 이미지나 PCM을 저장하지 않는다.
- 디코더 재정렬과 코덱 내부 메모리는 별도다. 위 숫자는 시작 설정이며 실제 메모리를 보장하는 상한이 아니다. 교착 없이 backpressure가 작동하는지 1단계에서 검증한다.
- 프레임 사용 후 close(), object URL 해제, AudioBufferSource 정리, encoder/decoder close를 모든 종료 경로에 둔다.

## 12. 프로젝트 저장과 복원

JSON에는 원본 파일을 넣지 않고 Asset 메타데이터와 편집 정보만 저장한다. 파일 선택 권한과 object URL은 새로고침 후 유지된다고 가정하지 않는다. IndexedDB 자동 저장도 원본 영상의 영구 보관을 의미하지 않는다.

복원 시 누락 목록을 보여주고 사용자가 재선택한다. 이름·크기·수정 시각과 선택적 fingerprint를 비교하되, 메타데이터 일치를 완전한 파일 동일성으로 설명하지 않는다. 디코딩 정보와 길이를 다시 검사하고 불일치 시 연결을 거부하거나 명시적으로 교체하도록 한다. 누락 원본이 있으면 해당 클립은 표시하되 재생·출력을 제한한다.

프로젝트 schemaVersion을 검증하고 알 수 없는 상위 버전은 읽기 실패 이유를 안내한다. 마이그레이션은 순수 함수로 구현한다. 자동 저장은 편집 명령 확정 후 debounce하며 실패·할당량 초과는 화면에 알린다. 원본 전체 OPFS 복사는 명시적인 후속 기능이며 기본 동작으로 넣지 않는다.

## 13. 화면과 접근성

레이아웃은 미디어 목록 / 미리보기 / 선택 항목 속성 / 하단 타임라인으로 구성한다. 상단에 프로젝트 열기·저장·실행 취소·내보내기를 둔다. 내보내기 창에는 형식·크기·예상 용량·진행률·취소를 표시한다.

단축키는 Space 재생/정지, 방향키 출력 프레임 이동, S 분할, Delete 선택 삭제, Ctrl/Cmd+Z 실행 취소, Ctrl/Cmd+Shift+Z 다시 실행을 기본으로 한다. 텍스트 입력 중 편집 단축키를 가로채지 않는다. 드래그 작업에는 시간 입력·이동 버튼 등 키보드 대안을 제공한다. 오류·선택·지원 상태를 색상만으로 구분하지 않는다.

## 14. 예상 저장소 구조

아래는 계층별 구성이다. 실제 파일과 모듈의 현재 상태는 README.md의 모듈 지도를 참고한다.

```text
src/
  app/             앱 초기화·지원 검사·전역 오류
  editor/          React 편집 화면·타임라인 UI
  project/         모델·검증·명령·이력·시간 매핑
  media/           Mediabunny·WebCodecs 어댑터·트랙 분석
  playback/        재생 시계·시킹·오디오 스케줄러
  render/          공통 레이아웃·영상/자막 합성·폰트
  audio/           PCM 변환·리샘플링·gain
  export/          프레임/샘플 일정·지원 협상·출력 target
  workers/         메시지 DTO·decode/export 진입점
  storage/         IndexedDB·JSON·선택적 OPFS
public/
  fonts/           재배포 가능한 한글 폰트·고지
tests/            순수 로직·브라우저 검사·작은 합성 미디어
.github/workflows/ 정적 빌드 검사·Pages 배포
```

## 15. 정적 배포와 공급망

Vite build 결과 `dist/`만 배포한다. project Pages라면 base를 `/ssg-clip-maker/`로 설정하고, 사용자 루트 사이트나 커스텀 도메인에서는 `/`로 바꾼다. Worker·폰트 경로도 이 base에서 동작해야 한다.[S11]

서버 rewrite가 필요한 history routing을 사용하지 않는다. 초기 버전은 단일 화면 또는 hash route를 사용한다. SharedArrayBuffer, COOP/COEP, Service Worker는 필수 전제가 아니다. 오프라인 설치/PWA는 후속 범위다. 첫 방문과 앱 파일 로딩에는 네트워크가 필요하다.

외부 서비스 키를 번들에 넣지 않는다. npm 의존성과 폰트의 라이선스·보안 상태를 기록하고, 실행 시 외부 CDN에서 엔진을 내려받지 않도록 번들한다. 사용 영상과 출력 영상은 저장소에 커밋하지 않는다. 테스트는 작고 재배포 가능한 합성 fixture를 사용한다.

GitHub Actions의 빌드에는 런타임 서버가 필요 없으며, 배포 workflow는 필요한 최소 권한으로 구성한다. 실제 배포가 검증되기 전에 배포 성공 배지를 붙이지 않는다.

## 16. 구현 순서와 완료 기준

| 단계 | 산출물 | 다음 단계로 넘어가는 조건 |
| --- | --- | --- |
| 0. 골격 | Vite/React/TS, 잠금 파일, 지원 검사 화면, 정적 base | 로컬·정적 빌드에서 Worker와 폰트 로딩 |
| 1. 미디어 수직 검증 | 입력→임의 컷→한글 합성→소리 포함 출력의 최소 화면 | 키프레임 밖 컷, 두 파일 연결, A/V sync, 저장/취소 검증. 오디오 리샘플링·output target 선택 확정 |
| 2. 편집 모델 | 시간 계약·명령·undo/redo·JSON 검증 | 분할/트림/재배열과 경계값 순수 로직 검사 통과 |
| 3. 미리보기 | Worker decode·오디오 시계·seek·공통 렌더러 | 반복 시킹 후 최신 프레임 표시, 경계 소리·버퍼링·정지 검증 |
| 4. 편집 UI | 타임라인·자막·크롭·음량·키보드 조작 | 실제 편집→미리보기→출력의 시각/시간 일치 |
| 5. 복구·견고성 | 자동 저장·재연결·출력 크기 제한·오류 복구 | 새로고침/원본 누락/취소 후 재실행, 메모리 누수 회귀 검사 |
| 6. 정적 배포 | CI·GitHub Pages·사용 안내·검증 기록 | 실제 HTTPS 하위 경로에서 가져오기부터 파일 재생까지 통과 |

넓은 UI 구현에 앞서 1단계에서 핵심 파이프라인을 입증한다. API 존재 확인이나 무음 한 프레임 인코딩만으로 완료 처리하지 않는다. 단계가 끝날 때 README의 현재 상태를 갱신한다.

### 검증 행렬

- 합성 영상: 프레임 번호·시간코드·시각 플래시와 동기화된 비프음을 포함한다. 무음, mono/stereo, 44.1/48kHz, 회전 영상, VFR, 서로 다른 해상도·FPS, 마지막 부분 프레임을 포함한다.
- 컷: 키프레임 사이 시작, 첫/마지막 프레임, 연속 분할·삭제·재배열, 두 클립 경계에서 검은 프레임·이전 프레임 반복 여부를 확인한다.
- 출력: 길이 오차는 출력 1프레임 이내, 시작/중간/끝 A/V 오차는 목표 50ms 이내로 측정한다. 아직 달성한 결과가 아니다. codec delay를 고려해 측정법과 결과를 남긴다.
- 자막: 경계 시점, 한글·줄바꿈·긴 문장, 동일 폰트, 세로/정사각 출력의 미리보기 대비 위치·크기를 확인한다.
- 자원: seek 100회·연속 export 3회·취소 후 export에서 해제 누락과 메모리 증가 추세를 확인한다. 최초 실행 때 cold/warm 및 기기·OS·브라우저 버전을 기록한다.
- 실패: 손상/미지원 파일, encoder 부재, 저장 권한 취소, 저장 공간 부족, Worker 오류, 탭 숨김, 원본 누락을 검사한다.
- 브라우저: Windows/macOS Chrome·Edge를 우선 기록한다. Safari·Firefox·모바일은 탐색 검사 후 확인된 조합만 지원표에 추가한다. 자동화 환경의 소프트웨어 코덱 결과를 실제 기기 지원으로 일반화하지 않는다.
- 배포: `/ssg-clip-maker/`에서 새로고침·Worker·폰트·파일 저장을 검사하고, Network 탭에서 원본/자막의 외부 전송이 없는지 확인한다.

## 17. 남은 실측 항목과 변경 규칙

제품 범위·시간 계약·레이어 경계는 이 문서를 기준으로 구현한다. 다음 항목은 임의의 미정 기능이 아니라 1단계에서 결론 내릴 기술 검증 항목이다.

| 항목 | 기본 방향 | 검증 실패 시 처리 |
| --- | --- | --- |
| Mediabunny API·버전 | 브라우저용 부분 읽기·샘플 접근·mux 사용 | 어댑터 안에서 조정하고 근거·버전 기록 |
| PCM 리샘플러 | 상태 유지·블록 처리 | 품질/메모리를 만족하는 구현으로 교체, 전체 파일 방식은 피함 |
| OffscreenCanvas·폰트 | Worker 렌더링 | main-thread 합성 어댑터로 대체하되 출력 일정은 유지 |
| AAC/대체 코덱 | 실제 설정 지원 검사 | 대체 출력 안내 또는 출력 불가 표시 |
| 디스크 출력 | seek 가능한 target와 muxer 모드 검증 | OPFS 또는 제한된 Blob 경로 |
| 자원 예산·5분 목표 | 위 초기값을 적용해 측정 | 측정에 따라 낮추고 지원 한계를 공개 |

새로운 기능·성능 보장을 추가할 때는 실제 검증 기록을 함께 갱신한다. 설계 변경은 문서에 이유와 영향 범위를 남긴다. 브라우저 샌드박스가 코덱 라이선스 문제를 모두 없앤다는 설명, 모든 브라우저 지원, 무조건 GPU 가속, 크래시 원천 방지 같은 표현을 사용하지 않는다.[S7]

## 18. 참고 자료

아래는 2026-11-14에 확인한 공식 문서 또는 제작자 자료다. API와 지원 현황은 구현 시 다시 확인한다. 이 문서의 UX 규칙·모델·자원 예산·완료 기준은 프로젝트의 설계 결정이며 출처가 보증하는 성능 수치가 아니다.

- [S1 GitHub Pages의 정적 호스팅 모델](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [S2 WebCodecs 개념·API·컨테이너 처리 경계](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [S3 mp4-muxer 유지보수 종료·Mediabunny 전환 안내](https://github.com/Vanilagy/mp4-muxer)
- [S4 Mediabunny 형식·코덱·지원 검사](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [S5 Mediabunny 미디어 읽기](https://mediabunny.dev/guide/reading-media-files)
- [S6 Mediabunny 출력과 target](https://mediabunny.dev/guide/writing-media-files)
- [S7 코덱 선택·인코딩/디코딩 차이·H.264 이용 조건](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)
- [S8 FFmpeg.wasm 단일/다중 스레드 구조](https://ffmpegwasm.netlify.app/docs/overview/)
- [S9 Cross-origin isolation과 SharedArrayBuffer](https://web.dev/articles/cross-origin-isolation-guide)
- [S10 OPFS와 저장소 제약](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [S11 Vite 정적 배포·GitHub Pages base](https://vite.dev/guide/static-deploy.html#github-pages)
- [S12 Chrome의 WebCodecs·Worker 처리 지침](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [S13 WebCodecs 사용·오디오 처리](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API)

## 19. 설계 변경 기록

- 2026-11-14: 중복된 초기 파이프라인 문서를 상세 설계로 교체. mp4-muxer 대신 Mediabunny를 선정하고 코덱 협상, 비파괴 타임라인, 미리보기/출력 분리, 오디오 동기화, 자원 수명, 저장/복구, 단계별 검증 기준을 추가. 성능·라이선스·호환성에 대한 무조건 보장을 제거.

## 20. 구현 착수 시 확정한 UI·요구사항 (2026-11-14)

이번 사용자 요청은 이전 MVP의 30fps 고정 및 오디오 볼륨 UI보다 우선한다. 아래 계약을 적용하며 구현 순서는 고정된 CHECKLIST.md를 따른다. CHECKLIST.md는 최초 작성 후 문구·순서·항목을 수정하지 않고 완료 표기 [v]만 허용한다. 검증 결과와 추가 요구는 이 문서 및 IMPLEMENTATION.md에 기록한다.

| UI 모듈 | 책임 | 입력/출력 |
| --- | --- | --- |
| Toolbar | 프로젝트 열기/저장, undo/redo, 도움말, 출력 열기 | 프로젝트 명령·파일 서비스 |
| AssetPanel | 다중 임포트, 에셋 카드·썸네일·길이, 우클릭/삽입 버튼, 드래그 시작 | MediaRegistry → Asset DTO, insert 명령 |
| PreviewPanel | 50% 크기 Canvas 표시, 버퍼링/미지원 표시 | PlaybackService의 시간·프레임 |
| Transport | 재생/정지, 처음/끝, 프레임 이동, 현재/전체 시간 | playback/seek 요청 |
| Timeline | 눈금·줌·스크롤, 플레이헤드, 클립 선택/삽입/재배열·트림 | project layout + 명령, seek |
| Inspector | 선택 클립 원본 in/out·변환, 프로젝트 비율, 자막 편집 | 순수 project 명령 |
| ExportDialog | 형식/해상도/FPS·지원 검사, 진행/취소/오류 | 최종 project snapshot + registry files → ExportService |

표시 UI는 React로 나누며 media/render/playback/export는 React에 의존하지 않는다. 타임라인 drop 위치는 클립 경계 삽입이며 기존 클립 중간으로 drop하면 가까운 경계를 선택한다. 같은 트랙은 빈틈 없이 이어진다. 원본 에셋은 클립을 삭제해도 보관함에 남는다. 클립과 에셋의 드래그 데이터 타입을 분리한다.

원본 오디오는 독립 트랙 편집 없이 영상 클립에 결합한다. in/out·이동·분할·삭제는 하나의 Clip 모델을 통해 영상과 오디오 모두에 적용한다. 오디오 볼륨/음소거 편집 UI는 이번 범위에서 제외한다. 내부 PCM 변환과 원본 무음 처리는 필요하다.

출력은 1080p/720p/480p 및 30/45/60fps를 선택한다. 가로 크기는 1920×1080, 1280×720, 854×480이며 세로는 너비/높이를 교환하고 정사각은 짧은 변을 기준으로 한다. FPS는 Project와 ExportSettings에 30|45|60으로 제한해 저장한다. 프레임 계산은 n*1e6/fps에서 매번 반올림한다. 내보내기에서 선택한 FPS가 최종 스케줄러의 기준이다.

미리보기는 1080p 기준 가로·세로 각각 절반(가로형 960×540)으로 합성한다. 이는 픽셀 수가 1/4인 표시 정책이며 실제 연산 시간의 절반 감소를 보장하지 않는다. 디코딩은 원본 코덱에 따라 여전히 고비용일 수 있다. 출력은 원본 파일을 다시 읽고 출력 크기로 공통 합성기를 실행한다.

출력 시작 시 검증한 최종 프로젝트를 복제해 Worker에 전달하고 완료/취소까지 편집을 잠근다. 미리보기의 캔버스·오디오 재생 상태를 캡처해 출력하지 않는다. 지원 검사 실패 시 무음 대체나 다른 형식으로 자동 변경하지 않는다.

### 구현 시 API 검토 자료

- Mediabunny Media sinks: https://mediabunny.dev/guide/media-sinks
- Mediabunny Media sources: https://mediabunny.dev/guide/media-sources
- Vite 시작/정적 빌드: https://vite.dev/guide/

이 자료의 API는 설치한 잠금 버전의 타입과 함께 확인한다. 설치 버전과 실제 검증 결과는 IMPLEMENTATION.md에 남긴다.

## 21. 첫 구현의 확정 사항

실제 파일은 README의 모듈 지도와 src/project/model.ts를 기준으로 한다. 직렬화 schemaVersion은 1이며 클립은 inUs/outUs와 transform(fit/scale/x/y)를 가진다. 원본 오디오 편집 속성은 저장하지 않는다. Project에는 aspect 및 fps를 저장하고 내보내기별 해상도/형식/FPS는 ExportSettings로 분리한다. 타임라인은 클립 배열 순서에서 도출한다. Asset에는 현재 구현에서 필요한 hasAudio와 코덱·파일 메타데이터를 보관하며 회전 정규화는 CanvasSink가 처리한다.

미리보기와 출력 모두 Mediabunny CanvasSink의 순차 읽기와 lookahead 1장을 사용한다. 명시적인 raw VideoFrame 캐시를 추가하지 않고 canvas pool 3장과 라이브러리의 제한된 선행 디코딩을 사용한다. 이전에 제시한 큐 8개는 커스텀 코덱 큐 구현 시의 시작 예산이며 현재 라이브러리 내부 큐의 고정 보장치가 아니다. 미리보기 원본 읽기 캔버스는 긴 변 960 이하로 제한한다. 큰 원본의 실제 디코딩 비용·GPU 메모리는 별도다.

오디오는 AudioSampleSink에서 PCM으로 복사 후 즉시 샘플을 해제하며 절대 원본 timestamp에 따른 선형 보간으로 48kHz stereo 블록을 만든다. 다운샘플링의 스튜디오 수준 품질이나 고급 필터를 보장하지 않는다. 별도 오디오 편집 UI는 없다. 미리보기는 약 0.7초까지만 미리 예약하고 늦게 도착한 블록은 재생 기준점을 다시 맞춘다.

출력은 CanvasSource/AudioSampleSource의 add Promise를 기다려 backpressure를 적용하고 작은 시간 창으로 영상·소리를 번갈아 공급한다. FPS metadata를 인코더에 전달하므로 마지막 부분 프레임은 출력 프레임 눈금으로 반올림될 수 있다. 길이 허용 오차는 1프레임이다. MP4는 fastStart:false를 선택해 전체 mdat을 in-memory fast-start로 보관하지 않는다. 직접 파일 저장에서는 StreamTarget의 position을 FileSystemWritableFileStream.write에 전달해 랜덤 쓰기를 지원한다. 취소/실패 시 commit 전 디스크 스트림을 abort한다. OPFS는 검사에서 직접 저장 어댑터를 확인하는 데 사용하며 제품의 별도 OPFS 출력 선택지는 현재 없다.

자동 저장은 IndexedDB를 사용하며 원본 File/영상은 저장하지 않는다. 이름·크기·수정 시각·길이·표시 크기·오디오 유무를 비교해 원본 재연결을 검사한다. 내용 해시는 현재 추가하지 않았다. 썸네일은 240×135, 최대 200개에 생성하고 에셋 메타데이터는 최대 500개까지 받는다. 프로젝트 JSON은 2MB 이하로 제한한다.

구현·브라우저 결과와 남은 공개 배포 검증은 IMPLEMENTATION.md에서 관리한다. CHECKLIST.md와 CHECKLIST.sha256의 최초 원문은 유지한다.

## 22. 배포 위치와 시작 실패 처리 수정 (2026-11-14)

이전 `/ssg-clip-maker/` 고정 base 정책을 대체하여 Vite base는 `./`를 사용한다. 같은 dist를 도메인 루트와 저장소 하위 경로에 배포할 수 있다. Worker 폰트는 src/render/font.ts에서 Vite asset URL import로 해석하고, 순수 합성 계산은 compositor.ts에 유지한다. 앱 파일을 읽지 못하면 초기 HTML의 안내를 표시한다. 정적 회귀 검사는 rewrite 없는 파일 서버의 두 배포 위치에서 수행하며 실제 공개 재배포 확인과 구분한다.

## 23. v2 자막 블록·동시 분할·재생 개선

자막 선택과 속성 탭은 App이 영상 선택과 함께 관리하고 SubtitleBlock이 기존 자막 레인에서 선택·이동·트림을 처리한다. 이동/트림 후보·인접 스냅·겹침 검사는 project/subtitles.ts에서 계산하며 놓을 때 cueRange 명령 한 번으로 확정한다. split은 교차 자막도 나누며 영상·자막을 하나의 undo 이력으로 반영한다. 자막은 영상 이동/삭제에 자동 연결하지 않고 프로젝트 시간 기준을 유지한다.

재생은 무음의 performance.now 시계와 소리가 있는 프로젝트의 Web Audio 시계를 분리한다. 오디오는 사용자 동작에서 resume하고 실행 상태·시간 제한·중단/시계 정지를 확인한다. 첫 프레임이 준비된 뒤 재생 시간을 진행하며 오래된 시작 요청은 새 재생에 영향을 주지 않는다. 숫자 1 분할과 2 선택 삭제 및 자막 내부 복사/붙여넣기는 화면 안내를 추가하지 않고 연결했다. 문제 코드·재현 조건·반영 내용·검증과 한계는 checklist_v2.md가 기준이다. 기존 CHECKLIST.md와 해시는 유지한다.
