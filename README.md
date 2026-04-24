# blog-automation

Notion source notes -> blog draft / LinkedIn draft workflow for Codex.

## What this repo does

- Pull a source page from Notion by URL, page id, page path, or database filter.
- Save normalized source artifacts into `output/`.
- Draft a Tistory-style Markdown blog post.
- Optionally publish the final draft under another Notion page.

## Environment

Copy `.env.example` to `.env`.

Required:

- `NOTION_API_KEY`

Optional:

- `NOTION_ROOT_PAGE_ID`
- `NOTION_BLOG_SOURCE_PATH`
- `NOTION_LINKEDIN_SOURCE_PATH`
- `NOTION_BLOG_TARGET_PAGE_ID`
- `BLOG_DRAFT_MODE`
- `OPENAI_API_KEY`

`BLOG_DRAFT_MODE` defaults to `codex`. In this mode, `npm run create-blog` does not call the OpenAI API directly. Instead it uses the locally installed Codex CLI through your ChatGPT login.

Use `BLOG_DRAFT_MODE=openai` only if you explicitly want direct API draft generation.

## Blog workflow

### 1. Pull from a Notion URL

```powershell
npm run create-blog -- "https://www.notion.so/...."
```

This always writes:

- `output/create-blog-source.md`
- `output/create-blog-source.json`

### 2. Draft generation modes

#### API mode

If `BLOG_DRAFT_MODE=openai` and `OPENAI_API_KEY` is configured, the same command also writes:

- `output/create-blog.md`

If `NOTION_BLOG_TARGET_PAGE_ID` is configured, it also publishes the draft under that Notion page.

#### Codex mode

If `BLOG_DRAFT_MODE=codex` the command:

1. pulls the Notion source
2. writes `output/create-blog-source.*`
3. runs `codex exec` non-interactively
4. writes `output/create-blog.md`
5. publishes to Notion when `NOTION_BLOG_TARGET_PAGE_ID` is configured

It also writes:

- `output/create-blog-codex-prompt.md`
- `output/create-blog-codex-result.txt`

`output/create-blog-codex-prompt.md` is kept as a fallback prompt if the local Codex CLI execution fails.

### 3. Source-only mode

```powershell
npm run create-blog-source -- "https://www.notion.so/...."
```

Use this only when you want the pulled source artifacts without draft generation or Codex handoff.

## Page path mode

If you prefer paths instead of URLs:

```powershell
npm run create-blog -- "tcc.mw/프로젝트/어떤페이지"
```

To explore available paths:

```powershell
npm run list-notion-tree
npm run list-notion-tree -- "tcc.mw/프로젝트"
```

The tree command is intentionally shallow by default so it does not traverse the entire workspace unless needed.

## LinkedIn workflow

Pull source:

```powershell
npm run create-linkedin -- "https://www.notion.so/...."
```

Publish the generated LinkedIn draft to another Notion page or database:

```powershell
npm run publish-linkedin
```

## Files

- `scripts/create-blog.js`: blog entrypoint
- `scripts/create-blog-source.js`: source-only blog pull
- `scripts/create-linkedin.js`: LinkedIn source pull
- `scripts/list-notion-tree.js`: page path listing
- `scripts/publish-blog-draft.js`: publish `output/create-blog.md` into Notion
- `scripts/publish-linkedin.js`: publish `output/create-linkedin.md` into Notion
- `templates/tistory-blog-draft.md`: Tistory-style writing template
- `codex-skills/create-blog`: local skill draft

## Typical commands

```powershell
npm run create-blog -- "https://www.notion.so/...."
npm run create-blog -- "tcc.mw/프로젝트/어떤페이지"
npm run create-blog-source -- "https://www.notion.so/...."
npm run publish-blog-draft
npm run create-linkedin -- "https://www.notion.so/...."
npm run publish-linkedin
```
