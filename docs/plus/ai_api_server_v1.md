# AI API 서버 V1 · OpenAI 연결

- [v] `CHATGPT_API_KEY`를 서버 전용 OpenAI API 키로 사용한다. 브라우저에 키를 전달하지 않는다.
- [v] 공용 AI API 계층에 OpenAI 공급자 어댑터를 추가한다. AI Gen의 음성 준비·결과 편집·완료 시 적용·PASSWORD 인증 흐름은 유지한다.
- [v] `AI_PROVIDER=openai`로 공급자를 선택하고 `POST https://api.openai.com/v1/audio/transcriptions`를 호출한다. 기본 전사 모델은 `gpt-transcribe`, 변경은 서버 환경변수 `OPENAI_TRANSCRIBE_MODEL`로 설정한다. 공급자 장애 시 DeepSeek로 자동 전송하지 않는다.
- [v] 전사 결과를 기존 공통 계약으로 변환한다. 음성 길이는 업로드 WAV에서 계산하며 자막 위치는 AI Gen의 기존 로컬 구간 시간을 사용한다.
- [v] 인증·사용 한도·잔액·응답 오류를 구분하여 모달에 표시한다. 실제 음성 전사에는 OpenAI API 프로젝트의 권한·결제·요청 한도가 필요하다.

```dotenv
CHATGPT_API_KEY=서버에서만_사용하는_OpenAI_API_키
AI_PROVIDER=openai
# 선택
OPENAI_TRANSCRIBE_MODEL=gpt-transcribe
```

로컬 `.env.local`의 공급자 선택값만 `openai`로 변경했다. API 키·PASSWORD 값은 변경하지 않았다. 기존 개발 서버를 Ctrl+C로 종료하고 `npm run dev`로 다시 실행한다. 배포 환경에도 위 키와 공급자 선택을 별도 등록해야 한다.

최소 확인: `npm run ai:check -- --openai`로 사용자 데이터가 없는 1초 무음 WAV를 전송했다. 키 설정은 확인됐으나 **HTTP 429(요청 한도)**가 반환되어 성공적인 전사·품질은 미확인이다. 반복 호출은 하지 않았으며 계정·모델의 한도 확인 후 다시 확인해야 한다. 브라우저·실제 영상 검증은 생략한다.

공식 출처: [OpenAI 파일 전사 가이드](https://developers.openai.com/api/docs/guides/speech-to-text), [전사 API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create). SDK 없이 표준 HTTP로 연결한다.
