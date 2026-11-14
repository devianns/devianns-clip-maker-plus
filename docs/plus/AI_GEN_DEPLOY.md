# Plus AI Gen 실행·배포

## 로컬 실행

Node.js 24를 권장한다. 서버는 Node의 TypeScript 타입 제거 실행을 사용하고, `server:build`는 서버 코드를 출력하는 대신 서버 타입을 검사한다.

```powershell
npm.cmd ci
npm.cmd run dev
```

프런트는 `http://127.0.0.1:5173`, API는 기본 `127.0.0.1:8787`이다. `npm run dev`는 이제 웹과 AI 서버를 함께 실행한다. 기존 `dev:plus`도 같은 동작이다. 프런트만 실행하려면 `npm run dev:ui`, API만 실행하려면 `npm run server:dev`를 사용한다. 개발 서버만 `.env.local`을 로딩한다. 기본 편집은 AI 서버 없이도 실행할 수 있다.

이전 개발 서버는 Ctrl+C로 종료한 후 다시 실행한다. 터미널에 `AI API server ready: http://127.0.0.1:8787`가 보여야 한다. 웹만 실행된 상태에서 AI를 호출하면 Vite 프록시의 연결 오류(500)가 발생할 수 있다. 환경변수 변경 후에도 서버를 재시작해야 한다.

```dotenv
# .env.local — 커밋하지 않음
DEEPSEEK_API_KEY=서버에서만_사용하는_키
AI_PROVIDER=deepseek
# npm run password:hash 로 생성한 해시. 평문 또는 your_password_here를 그대로 넣지 않음
PASSWORD=scrypt$생성된_salt$생성된_hash
```

`npm run password:hash`를 대화형 터미널에서 실행하고 사용할 비밀번호를 두 번 입력한다. 출력된 `PASSWORD=...`의 값을 `.env.local`과 배포 환경변수 PASSWORD에 넣는다. 비밀번호는 표시되지 않으며 해시는 복호화용 암호문이 아닌 scrypt 검증값이다. 환경변수 변경 후 서버를 재시작한다.

AI Gen 버튼을 누르면 먼저 원래 비밀번호를 입력한다. 서버 검증 성공 시에만 기능 모달로 진입하고 1시간짜리 HttpOnly 인증 쿠키를 사용한다. 서버 해시 변경 시 기존 쿠키도 무효화된다. 비밀번호는 localStorage·프로젝트·로그에 보관하지 않는다. 개발 모드에서 PASSWORD가 아예 없을 때만 로컬 인증을 생략하고, 운영은 올바른 해시가 없으면 차단한다.

인증 후 외부 전송 안내를 확인하고 시작한다. 선택 라인의 음성 구간을 최대 15초씩 전사하며 한 번에 하나의 요청만 실행한다. 첫 요청 실패 후에는 남은 요청을 중지하고 실패·미완료 구간의 재시도를 제공한다.

## 일반 서버

```sh
npm ci
npm run build
npm run server:build
npm run server:start
```

정적 웹 서버로 `dist/`를 제공하고 `/api/ai/*`는 Node 서버에 프록시한다. Node 서버는 정적 파일 서버가 아니다. 프록시에서 요청 스트리밍·약 1MiB 업로드·60초 이상 응답 대기를 허용하고 자체 제한은 배포 환경에 맞춘다. 외부 인터페이스에서 직접 수신해야 하면 `AI_HOST=0.0.0.0`을 설정한다.

운영 서버는 `.env.local`을 자동 로딩하지 않으며 아래 값을 서버 프로세스 환경에 등록해야 한다.

| 변수 | 역할 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 공급자 인증 키, 프런트에 공개 금지 |
| `CHATGPT_API_KEY` | OpenAI 공급자 인증 키, 프런트에 공개 금지 |
| `AI_PROVIDER` | `openai` 또는 `deepseek`. 미지정 시 OpenAI 키가 있으면 openai 우선 |
| `OPENAI_TRANSCRIBE_MODEL` | OpenAI 전사 모델. 기본 `gpt-transcribe` |
| `PASSWORD` | `password:hash`로 생성한 scrypt 해시. 운영 필수. 기존 AI_ACCESS_TOKEN을 대체 |
| `AI_ALLOWED_ORIGINS` | 웹 앱 Origin 목록, 쉼표 구분. 실제 도메인 정확히 지정 |
| `AI_ADMISSION_URL` | 운영의 공유 요청량 제한 HTTP 서비스 주소 |
| `AI_ADMISSION_TOKEN` | 해당 공유 서비스 인증 토큰 |
| `AI_HOST` / `AI_PORT` | 일반 서버 수신 주소 / 포트. 기본 `127.0.0.1:8787` |
| `VITE_AI_API_BASE` | 선택적 공개 자체 API 기준 주소. 기본 `/api/ai`. 변경 후 프런트 재빌드 필요 |

공유 제한 서비스는 인증된 POST `{identity, limit, windowSeconds}`를 원자적으로 집계하고 `{allowed: boolean}`을 반환해야 한다. 현재 identity는 서비스 전체를 의미하며 전역 30회/분 예산으로 동작한다. 특정 저장소·플랫폼 구현은 포함하지 않았다. 저장소 기반 제한 서비스나 기존 게이트웨이를 이 계약에 연결해야 한다. 서버 키로 호출할 수 있는 공개 API이므로 운영 인증 또는 공유 제한 서비스가 없으면 **503으로 차단**한다. 프로세스 내부 동시 요청 2개 제한은 공유 제한을 대체하지 않는다.

로그인도 별도 identity로 공유 제한을 적용하고 프로세스별 분당 10회·동시 2회 제한을 추가한다. 인증 쿠키는 운영에서 Secure·HttpOnly·SameSite=Strict로 설정한다. 운영은 HTTPS와 같은 사이트의 `/api/ai` 경로를 사용하도록 프록시한다. 서로 다른 사이트 도메인 사이의 인증 쿠키 전송은 지원하지 않는다.

## Vercel 및 다른 서버리스

Vercel은 기존 Vite 빌드 출력 `dist/`와 `api/ai/[action].ts` 진입점을 사용한다. 별도 SDK 의존성은 없다. 운영 환경변수는 위와 동일하게 등록한다. 선택한 요금제·런타임의 함수 실행 시간이 55초 API 타임아웃을 감당하는지 확인한다. 더 짧은 환경은 타임아웃·음성 조각 상한을 함께 낮추어야 한다. 실제 Vercel 배포는 아직 검증하지 않았다.

다른 서버리스는 `modules/ai-api/server/handler.ts`의 표준 Request/Response 함수를 해당 플랫폼 진입점에서 호출한다. 전체 Node 배포와 서버리스는 같은 공급자 어댑터를 사용한다. 응답 이후 진행하는 메모리 작업·백그라운드 큐에 의존하지 않는다.

## 최소 API 연결 확인

```sh
npm run ai:check
```

명시적으로 실행할 때만 1초 합성 무음 WAV를 공급자에 전송한다. 사용자 파일·키·전사 텍스트는 출력하지 않으며 실제 호출에 과금될 수 있다. 실행 결과는 계정에 따라 다르다.

이번 구현에서의 실제 결과: `.env.local` 키 설정을 읽어 공급자에 요청했으나 **HTTP 402**가 반환되어 전사 성공은 확인하지 못했다. 공식 오류 문서에서는 잔액 부족으로 설명한다. 계정 잔액 확인 후 다시 실행해야 한다. [공식 오류 코드](https://api-docs.deepseek.com/quick_start/error_codes/)

브라우저·실제 편집기·Vercel 배포 검증은 수행하지 않았다. 단위 검사 소스는 추가했지만 이번 요청에서는 실행하지 않는다. 후속 검증에서 전사 정확도, 취소 후 기본 편집 복귀, 새 라인 배치, 음성 시작·종료 시간, undo까지 확인해야 한다.
