# blog-automation

## 프로젝트 개요

Notion에 정리된 원본 노트를 가져와 블로그 초안, LinkedIn용 원본 자료, Notion 정리본을 만드는 자동화 프로젝트입니다.

주요 흐름은 다음과 같습니다.

- `create-blog`: Notion 원본을 가져와 블로그 초안을 생성하고, 설정된 경우 Notion 대상 페이지에 발행합니다.
- `create-blog-source`: 블로그 초안 생성 없이 Notion 원본만 Markdown과 메타데이터로 저장합니다.
- `create-linkedin`: LinkedIn용 Notion 원본을 Markdown과 메타데이터로 저장합니다.
- `publish-linkedin`: 작성된 LinkedIn 초안을 Notion 페이지 또는 데이터베이스에 발행합니다.
- `create-notion`: Notion 원본 페이지를 `원본`과 `정리본` child page 구조로 재구성합니다.
- `list-notion-tree`: Notion 페이지 트리를 조회해 경로 기반 입력에 사용할 페이지 경로를 확인합니다.

생성 결과는 기본적으로 `output/` 디렉터리에 저장됩니다.

## 요구 사항

- Node.js 18 이상
- npm
- Notion integration token
- 기본 블로그 초안 생성 모드(`BLOG_DRAFT_MODE=codex`) 또는 `create-notion`을 사용할 경우 로컬 `codex` CLI 설치 및 로그인
- OpenAI API로 블로그 초안을 생성할 경우 `OPENAI_API_KEY`

필수 환경 변수는 `.env`에 설정합니다. 시작점은 `.env.example`을 복사해서 만들면 됩니다.

```env
NOTION_API_KEY=secret_xxx
BLOG_DRAFT_MODE=codex
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
```

Notion 원본은 명령어 인자로 URL, page ID, page path를 직접 넘기거나 `.env`의 source 관련 변수로 지정할 수 있습니다.

## 빠른 시작

1. 환경 변수 파일을 만듭니다.

```powershell
Copy-Item .env.example .env
```

2. `.env`에 최소 설정을 입력합니다.

```env
NOTION_API_KEY=secret_xxx
BLOG_DRAFT_MODE=codex
```

3. Notion 원본 URL을 넘겨 블로그 초안을 생성합니다.

```powershell
npm run create-blog -- "https://www.notion.so/your-page"
```

4. 스크립트 문법을 확인합니다.

```powershell
npm run check
```

## 사용법

블로그 원본만 가져오기:

```powershell
npm run create-blog-source -- "https://www.notion.so/your-page"
```

블로그 초안 생성:

```powershell
npm run create-blog -- "https://www.notion.so/your-page"
```

기존 블로그 초안을 Notion에 발행:

```powershell
npm run publish-blog-draft
```

대상 페이지와 입력 파일을 직접 지정해 블로그 초안 발행:

```powershell
npm run publish-blog-draft -- "https://www.notion.so/target-page" "output/create-blog.md" "output/create-blog-source.json"
```

LinkedIn 원본 가져오기:

```powershell
npm run create-linkedin -- "https://www.notion.so/your-page"
```

LinkedIn 초안 발행:

```powershell
npm run publish-linkedin
```

Notion 페이지를 원본/정리본 child page 구조로 재구성:

```powershell
npm run create-notion -- "https://www.notion.so/your-page"
```

`create-notion`은 Notion 읽기/쓰기에는 `NOTION_API_KEY`를 사용하지만, 정리본 생성에는 OpenAI API 키를 사용하지 않고 로컬 `codex` CLI를 호출합니다.

Notion 페이지 트리 조회:

```powershell
npm run list-notion-tree
npm run list-notion-tree -- "프로젝트"
npm run list-notion-tree -- "프로젝트/초안" 2
```

URL 대신 page ID나 page path도 사용할 수 있습니다.

```powershell
npm run create-blog -- "123456781234123412341234567890ab"
npm run create-blog -- "프로젝트/초안/블로그 메모"
```
