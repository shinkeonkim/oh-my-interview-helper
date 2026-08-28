# Oh My Interview Helper

로컬에 이력서와 채용공고를 보관하고, 근거가 표시된 AI 면접 준비 자료를 만드는 오픈소스 도구입니다. 데이터는 기본적으로 사용자의 기기 안 SQLite와 content-addressed blob 저장소에 보관됩니다.

## 주요 기능

- PDF, DOCX, Markdown, 텍스트 이력서·포트폴리오 업로드 및 버전 관리
- 수동 입력, 파일, 공개 URL을 통한 채용공고 수집
- 지원 단계, 메모, 면접 일정과 이력 관리
- 공고별 7개 영역: 개요, 기업, 인물·팀, 이력서, 면접, 기술, 토픽 답안
- Anthropic/OpenAI API 및 격리된 Claude Code/Codex runner 전송 계층
- 외부 전송 전 정확한 입력 버전 확인과 명시적 동의
- 인용을 포함한 리서치, 준비 초안, 지원별 대화
- 생성 provenance와 원본·Provider·프롬프트 변경 감지
- 로컬 통합 검색과 활동 통계
- 한국어·영어, 라이트·다크·시스템 테마

## Docker로 실행

요구 사항은 Docker Engine과 Docker Compose v2입니다.

```bash
docker compose up --build -d
```

브라우저에서 <http://localhost:3000>을 엽니다. 데이터는 `interview-data` named volume에 유지됩니다.

```bash
# 로그 확인
docker compose logs -f app

# 중지
docker compose down

# 데이터까지 삭제할 때만 실행
docker compose down -v
```

호스트 포트를 바꾸려면 다음처럼 실행합니다. 보안상 허용 Host도 Compose가 같은 값으로 설정합니다.

```bash
APP_PORT=4173 docker compose up --build -d
```

Docker 이미지는 기본적으로 API 키 없이 실행됩니다. Provider 설정은 아래의 별도 secret 파일 구성을 사용하세요.

## 로컬 개발

요구 사항:

- Bun 1.3.10
- Node.js 22.14.0

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

개발 서버는 기본적으로 <http://127.0.0.1:3000>에서 실행됩니다. 클라이언트 HMR을 별도로 사용할 때는 다른 터미널에서 `bun run dev:client`를 실행합니다.

프로덕션 빌드 실행:

```bash
bun run build
bun run start
```

## AI Provider 설정

직접 API 키는 환경 변수 값 대신 저장소 밖의 파일로 전달하는 방식을 권장합니다.

```bash
mkdir -p .secrets
chmod 700 .secrets
printf '%s' 'your-key' > .secrets/anthropic_api_key
chmod 600 .secrets/anthropic_api_key
```

`.env` 예시:

```dotenv
ANTHROPIC_API_KEY_FILE=/absolute/path/to/.secrets/anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_ALLOWED_MODELS=claude-sonnet-4-20250514
```

OpenAI는 대응하는 `OPENAI_API_KEY_FILE`, `OPENAI_MODEL`, `OPENAI_ALLOWED_MODELS`를 사용합니다. 두 Provider는 독립적으로 구성되며 한 Provider가 실패해도 다른 Provider로 자동 fallback하지 않습니다.

Docker에서는 secret 파일을 읽기 전용으로 mount하고 컨테이너 내부 경로를 지정합니다.

```yaml
services:
  app:
    environment:
      ANTHROPIC_API_KEY_FILE: /run/secrets/anthropic_api_key
      ANTHROPIC_MODEL: claude-sonnet-4-20250514
      ANTHROPIC_ALLOWED_MODELS: claude-sonnet-4-20250514
    volumes:
      - ./.secrets/anthropic_api_key:/run/secrets/anthropic_api_key:ro
```

Claude Code와 Codex CLI는 서버가 임의의 로컬 프로세스를 실행하지 않도록 별도의 인증된 outbound runner 프로토콜로 격리됩니다. 먼저 사용할 CLI를 설치하고 로그인한 뒤, 설정 화면의 `runner 연결 코드 발급`으로 일회용 코드를 만듭니다.

다른 터미널에서 다음 명령으로 페어링합니다. runner는 Claude/Codex의 버전·필수 옵션·로그인과 도구를 사용하지 않는 최소 호출을 확인하고, 자격 증명을 사용자 설정 디렉터리에 `0600` 권한으로 저장합니다. 서버가 응답하지 않으면 페어링은 30초 안에 실패하므로 서버 실행 여부와 코드 만료 시각을 확인합니다.

```bash
bun packages/runner/src/bin.ts pair --code ABCD1234 --name my-local-runner
```

페어링 후 runner를 실행해 둡니다. 서버와 runner의 WebSocket 연결은 loopback 주소만 허용하며, 일시적으로 연결이 끊기면 자동 재연결합니다. 종료할 때는 `Ctrl+C`를 누릅니다.

```bash
bun packages/runner/src/bin.ts run
```

서버 포트가 다르면 두 명령 모두 `--endpoint ws://127.0.0.1:4173/api/runner/ws`를 추가합니다. 자격 증명 위치를 직접 관리하려면 두 명령에 같은 `--credentials /absolute/path/runner.json`을 지정합니다.

설정 화면에서 runner의 등록 상태와 최근 접속을 확인할 수 있습니다. `연결 해제`를 누르면 저장된 권한뿐 아니라 현재 WebSocket과 진행 중인 runner 작업도 즉시 중단됩니다. 인증이 거부된 runner CLI는 무한 재접속하지 않고 종료되며, 다시 사용하려면 새 코드로 페어링해야 합니다.

## 안전 모델

- 서버는 기본적으로 loopback(`127.0.0.1`)에만 bind합니다.
- Docker에서만 `BIND_HOST=0.0.0.0`을 명시하며 `LOCAL_HOSTS` 검증은 계속 적용됩니다.
- 모든 상태 변경 요청은 local Host/Origin 및 CSRF 검증을 거칩니다.
- 공개 URL 수집은 DNS 재검증, private IP 차단, redirect·크기·시간 제한을 적용합니다.
- 외부 AI 호출 전 목적지, 모델, 입력 버전과 hash를 확인합니다.
- 원문 지시를 신뢰하지 않으며 서버가 허용한 도구만 Agent에 제공합니다.

인터넷에 직접 공개하거나 reverse proxy 뒤에 배치하는 운영은 현재 지원 범위가 아닙니다.

## 검사

```bash
bun run lint
bun run typecheck
bun run check:i18n
bun test
bun run test:e2e
bun run build
```

## 저장 데이터와 백업

기본 데이터 경로는 `./data`이며 Docker에서는 `/app/data`입니다. 앱을 중지한 후 해당 디렉터리 또는 named volume 전체를 백업하세요. SQLite 파일과 blob 디렉터리를 서로 다른 시점으로 복사하면 일관성이 깨질 수 있습니다.

## 현재 제한 사항

- OCR은 지원하지 않아 이미지로만 구성된 PDF는 가져올 수 없습니다.
- 로그인이나 비공개 페이지를 리서치 출처로 가져오지 않습니다.
- AI 응답은 초안과 참고 의견이며 채용 의사결정을 대신하지 않습니다.
- CLI runner는 현재 저장소의 Bun 명령으로 실행하며, 독립 실행 파일과 패키지 레지스트리 배포는 제공하지 않습니다.

## 라이선스

[MIT](LICENSE)
