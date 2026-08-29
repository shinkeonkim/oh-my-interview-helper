# 기여 가이드

Oh My Interview Helper에 기여해 주셔서 감사합니다. 이 프로젝트는 로컬 우선 데이터 보관, 명시적 외부 전송 동의, 재현 가능한 근거를 기본 원칙으로 삼습니다.

## 개발 환경

- Bun 1.3.10
- Node.js 22.14.0
- Playwright Chromium

```bash
git clone <repository-url>
cd oh-my-interview-helper
cp .env.example .env
bun install --frozen-lockfile
bunx playwright install chromium
bun run dev
```

HMR을 사용할 때는 서버를 유지한 채 다른 터미널에서 `bun run dev:client`를 실행하고 <http://127.0.0.1:5173>을 엽니다.

## 변경 원칙

- 업로드 문서나 로컬 디렉터리에서 사용자 프로필을 암묵적으로 가져오지 않습니다.
- 외부 AI 전송에는 정확한 입력 버전, 목적지와 모델을 먼저 표시하고 사용자 동의를 받습니다.
- 공개 URL 수집은 공통 안전 가져오기 경계를 우회하지 않습니다.
- 기존 데이터베이스 변경은 새 migration으로 추가하며 적용된 migration을 수정하지 않습니다.
- 사용자에게 보이는 문구는 한국어와 영어 카탈로그를 함께 수정합니다.
- 기능 변경에는 정상 흐름뿐 아니라 실패·중복 요청·권한 경계 테스트를 포함합니다.

## 제출 전 검사

```bash
bun run lint
bun run typecheck
bun run check:i18n
bun run test
bun run build
bun run test:e2e
docker compose config --quiet
docker build -t oh-my-interview-helper:local .
```

커밋은 한 가지 논리 변경만 담고, Pull Request에는 변경 목적·검증 명령·보안 또는 데이터 호환성 영향을 적어 주세요. 취약점은 공개 Issue 대신 [SECURITY.md](SECURITY.md)의 절차로 제보합니다.
