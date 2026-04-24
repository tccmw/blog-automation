# blog-automation

Notion에 있는 소스 노트를 가져와 블로그 초안과 LinkedIn 초안 작업으로 이어주는 자동화 저장소입니다.

이 저장소는 다음 작업을 지원합니다.

- Notion URL, 페이지 ID, 페이지 경로, 데이터베이스/데이터 소스 필터로 원문 선택
- 블로그용 소스 정리 및 Markdown 초안 생성
- LinkedIn용 소스 정리 및 Notion 발행
- 결과물을 `output/` 폴더에 파일로 저장

## 프로젝트 개요

블로그 워크플로우는 두 가지 방식으로 동작합니다.

- `codex` 모드: 기본값입니다. `create-blog` 실행 시 Notion 소스를 가져온 뒤 로컬 `codex` CLI로 초안을 생성합니다.
- `openai` 모드: `OPENAI_API_KEY`가 있을 때 OpenAI API로 블로그 초안을 생성합니다.

LinkedIn 워크플로우는 먼저 소스를 가져온 뒤, 그 내용을 바탕으로 `output/create-linkedin.md`를 작성하고 Notion에 발행하는 흐름입니다.

## 요구 사항

- Node.js 18 이상 권장
- Notion integration token
- 블로그 자동 초안 생성 시 아래 둘 중 하나
  - 로컬 `codex` CLI 설치 및 로그인
  - `OPENAI_API_KEY`

현재 런타임용 외부 npm 패키지 의존성은 없어서, Node.js만 준비되어 있으면 바로 스크립트를 실행할 수 있습니다.

## 빠른 시작

### 1. 환경 변수 파일 만들기

`.env.example`을 복사해서 `.env`를 만듭니다.

```powershell
Copy-Item .env.example .env
```

최소 설정 예시는 아래와 같습니다.

```env
NOTION_API_KEY=secret_xxx
BLOG_DRAFT_MODE=codex
```

### 2. 소스 선택 방식 정하기

이 저장소는 소스를 세 가지 방식으로 찾습니다.

1. 명령행 인자로 직접 전달
2. 워크플로우별 환경 변수 사용
3. Notion 데이터 소스/데이터베이스에서 필터 검색

명령행 인자를 넘기면 환경 변수보다 우선합니다.

인자를 생략했을 때의 우선순위는 아래와 같습니다.

1. `NOTION_BLOG_SOURCE_PAGE_ID` 또는 `NOTION_LINKEDIN_SOURCE_PAGE_ID`
2. `NOTION_BLOG_SOURCE_PATH` 또는 `NOTION_LINKEDIN_SOURCE_PATH`
3. `NOTION_DATA_SOURCE_ID` 또는 `NOTION_DATABASE_ID` 기반 필터 조회

즉, 환경 변수만 잘 설정해 두면 아래처럼 인자 없이도 실행할 수 있습니다.

```powershell
npm run create-blog
npm run create-linkedin
```

## 환경 변수 정리

### 공통

- `NOTION_API_KEY`: 필수. Notion API 토큰
- `BLOG_DRAFT_MODE`: 블로그 초안 생성 방식. 기본값은 `codex`
- `OPENAI_API_KEY`: `BLOG_DRAFT_MODE=openai`일 때 필요
- `OPENAI_MODEL`: OpenAI 사용 모델. 기본값은 `gpt-5`

### 소스 선택 관련

CLI 인자를 주지 않았을 때 아래 값이 사용됩니다.

- `NOTION_BLOG_SOURCE_PAGE_ID`: 블로그 소스 페이지 ID
- `NOTION_BLOG_SOURCE_PATH`: 블로그 소스 페이지 경로
- `NOTION_LINKEDIN_SOURCE_PAGE_ID`: LinkedIn 소스 페이지 ID
- `NOTION_LINKEDIN_SOURCE_PATH`: LinkedIn 소스 페이지 경로
- `NOTION_ROOT_PAGE_ID`: 페이지 경로 모드에서 기준이 되는 루트 페이지 ID
- `NOTION_DATA_SOURCE_ID`: Notion data source 기반 조회
- `NOTION_DATABASE_ID`: Notion database 기반 조회

### 데이터베이스 필터 관련

소스를 데이터 소스/데이터베이스에서 찾을 때 사용합니다.

- `NOTION_STATUS_PROPERTY`: 기본값 `status`
- `NOTION_READY_STATUS_VALUE`: 기본값 `Ready`
- `NOTION_TYPE_PROPERTY`: 기본값 `type`
- `NOTION_PLATFORM_PROPERTY`: 기본값 `platform`
- `NOTION_BLOG_TYPE_VALUE`: 기본값 `blog`
- `NOTION_BLOG_PLATFORM_VALUE`: 기본값 빈 값
- `NOTION_LINKEDIN_TYPE_VALUE`: 기본값 `linkedin`
- `NOTION_LINKEDIN_PLATFORM_VALUE`: 기본값 빈 값

### 발행 대상 관련

- `NOTION_BLOG_TARGET_PAGE_ID`: 블로그 초안을 게시할 대상 페이지 ID 또는 Notion 페이지 URL
- `NOTION_LINKEDIN_TARGET_PAGE_ID`: LinkedIn 초안을 게시할 대상 페이지 ID
- `NOTION_LINKEDIN_TARGET_DATABASE_ID`: LinkedIn 초안을 게시할 대상 데이터베이스 ID
- `NOTION_LINKEDIN_TARGET_STATUS_PROPERTY`: LinkedIn 대상 데이터베이스의 상태 속성명
- `NOTION_LINKEDIN_TARGET_STATUS_VALUE`: LinkedIn 발행 시 넣을 상태값
- `NOTION_LINKEDIN_TITLE_SUFFIX`: 기본값 ` - LinkedIn`

## 소스 입력 방식

각 워크플로우는 아래 형태의 입력을 받을 수 있습니다.

- Notion URL
- 32자리 또는 하이픈 포함 페이지 ID
- 페이지 경로

예시:

```powershell
npm run create-blog -- "https://www.notion.so/your-page"
npm run create-blog -- "123456781234123412341234567890ab"
npm run create-blog -- "프로젝트/초안/Immer 정리"
```

## 블로그 사용 방법

### 1. 소스만 가져오기

블로그 초안 생성 없이 원문만 정리하려면 아래 명령을 사용합니다.

```powershell
npm run create-blog-source -- "https://www.notion.so/your-page"
```

생성 파일:

- `output/create-blog-source.md`
- `output/create-blog-source.json`

### 2. 블로그 초안까지 자동 생성하기

기본 모드인 `codex`에서는 아래 명령 하나로 소스 수집과 초안 생성까지 진행합니다.

```powershell
npm run create-blog -- "https://www.notion.so/your-page"
```

이 명령은 다음 순서로 동작합니다.

1. Notion 소스를 가져옵니다.
2. `output/create-blog-source.md`, `output/create-blog-source.json`을 저장합니다.
3. 로컬 `codex exec`를 호출해 블로그 초안을 만듭니다.
4. `output/create-blog.md`를 저장합니다.
5. `NOTION_BLOG_TARGET_PAGE_ID`가 있으면 Notion에 발행합니다.

추가 생성 파일:

- `output/create-blog.md`
- `output/create-blog-codex-prompt.md`
- `output/create-blog-codex-result.txt`
- `output/create-blog-codex.log`

`codex` CLI가 실패했을 때는 `output/create-blog-codex-prompt.md`를 열어 수동으로 이어서 작업할 수 있습니다.

### 3. OpenAI API로 블로그 초안 만들기

Codex CLI 대신 OpenAI API를 쓰려면 `.env`를 아래처럼 설정합니다.

```env
BLOG_DRAFT_MODE=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5
```

그 다음 같은 명령을 실행하면 됩니다.

```powershell
npm run create-blog -- "https://www.notion.so/your-page"
```

이 경우 `output/create-blog.md`가 OpenAI 응답으로 생성됩니다.

`BLOG_DRAFT_MODE=openai`인데 `OPENAI_API_KEY`가 없으면 자동으로 `codex` 모드로 되돌아갑니다.

### 4. 블로그 초안만 따로 발행하기

이미 `output/create-blog.md`가 있다면 아래 명령으로 따로 발행할 수 있습니다.

```powershell
npm run publish-blog-draft
```

대상 페이지를 명령행에서 직접 지정하려면:

```powershell
npm run publish-blog-draft -- "https://www.notion.so/target-page" "output/create-blog.md" "output/create-blog-source.json"
```

발행 결과는 `output/create-blog-published.json`에 저장됩니다.

## LinkedIn 사용 방법

### 1. 소스 가져오기

```powershell
npm run create-linkedin -- "https://www.notion.so/your-page"
```

생성 파일:

- `output/create-linkedin-source.md`
- `output/create-linkedin-source.json`

`npm run create-linkedin-source`도 같은 동작을 합니다.

### 2. LinkedIn 초안 작성하기

이 저장소에는 LinkedIn 초안을 자동 생성하는 별도 Node 스크립트는 없습니다. 대신 아래 파일을 바탕으로 `output/create-linkedin.md`를 작성해서 사용합니다.

- `output/create-linkedin-source.md`
- `output/create-linkedin-source.json`

권장 구조:

```md
# 제목

## Hook

## LinkedIn Post

## Key Points

## CTA
```

### 3. LinkedIn 초안 발행하기

대상 페이지 또는 대상 데이터베이스를 `.env`에 설정한 뒤 실행합니다.

```powershell
npm run publish-linkedin
```

기본 입력 파일은 아래 경로입니다.

- `output/create-linkedin.md`
- `output/create-linkedin-source.json`

발행 결과는 `output/create-linkedin-published.json`에 저장됩니다.

## 페이지 경로 탐색

페이지 경로 모드를 쓰려면 먼저 트리를 확인하는 편이 좋습니다.

```powershell
npm run list-notion-tree
npm run list-notion-tree -- "프로젝트"
npm run list-notion-tree -- "프로젝트/초안" 2
```

생성 파일:

- `output/notion-tree.txt`
- `output/notion-tree.json`

경로 모드 사용 시 `NOTION_ROOT_PAGE_ID`가 필요합니다.

## 자주 쓰는 명령어

```powershell
npm run create-blog -- "https://www.notion.so/your-page"
npm run create-blog-source -- "https://www.notion.so/your-page"
npm run publish-blog-draft
npm run create-linkedin -- "https://www.notion.so/your-page"
npm run publish-linkedin
npm run list-notion-tree
npm run check
```

## 출력 파일 정리

### 블로그

- `output/create-blog-source.md`: Notion 원문 Markdown
- `output/create-blog-source.json`: 소스 메타데이터
- `output/create-blog.md`: 최종 블로그 초안
- `output/create-blog-codex-prompt.md`: Codex 수동 이어쓰기용 프롬프트
- `output/create-blog-codex-result.txt`: Codex 실행 마지막 메시지
- `output/create-blog-codex.log`: Codex 실행 로그
- `output/create-blog-published.json`: 발행 결과

### LinkedIn

- `output/create-linkedin-source.md`: LinkedIn용 원문 Markdown
- `output/create-linkedin-source.json`: 소스 메타데이터
- `output/create-linkedin.md`: 최종 LinkedIn 초안
- `output/create-linkedin-published.json`: 발행 결과

## 트러블슈팅

- `Missing NOTION_API_KEY`: `.env`에 Notion 토큰이 없습니다.
- `Path mode requires NOTION_ROOT_PAGE_ID`: 경로 입력을 썼지만 루트 페이지 ID가 없습니다.
- `No Notion page matched the configured filters`: 데이터베이스 필터값이나 속성명이 실제 Notion 스키마와 다릅니다.
- `Failed to start Codex CLI`: 로컬 `codex` CLI가 설치되지 않았거나 로그인되지 않았습니다. `codex login status`로 상태를 확인하세요.

## 저장소 구조

- `scripts/create-blog.js`: 블로그 전체 워크플로우 진입점
- `scripts/create-blog-source.js`: 블로그 소스만 가져오기
- `scripts/create-linkedin.js`: LinkedIn 소스 가져오기
- `scripts/list-notion-tree.js`: Notion 페이지 경로 탐색
- `scripts/publish-blog-draft.js`: 블로그 초안 발행
- `scripts/publish-linkedin.js`: LinkedIn 초안 발행
- `templates/tistory-blog-draft.md`: 블로그 작성 템플릿
- `output/`: 생성 결과 저장 위치
