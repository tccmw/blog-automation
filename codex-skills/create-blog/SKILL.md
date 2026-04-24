---
name: create-blog
description: Pull a ready source note from Notion and draft a publishable blog post in this repository. Use when the user writes "create-blog", asks to turn a Notion note into a blog article, or wants Codex to draft long-form blog copy from the latest ready Notion entry.
---

# Create Blog

Run this workflow when the user invokes `create-blog`.

## Goal

Read a selected Notion source note from a Notion URL, page id, page path, or database workflow, turn it into a polished article, save the draft to `output/create-blog.md`, and publish it to a configured Notion draft page when available.

This workflow supports two modes:

- `API mode`: `BLOG_DRAFT_MODE=openai`. `scripts/create-blog.js` pulls the source, generates the draft, and publishes it when `OPENAI_API_KEY` is configured.
- `Codex mode`: `BLOG_DRAFT_MODE=codex` (default). `scripts/create-blog.js` pulls the source only and writes `output/create-blog-codex-prompt.md`. In this mode, Codex must draft `output/create-blog.md` and then run `scripts/publish-blog-draft.js` when publishing is needed.

## Required Flow

1. Verify that `scripts/create-blog.js` exists in the current repository.
2. When running inside an interactive Codex session, do not call `scripts/create-blog.js` because it can invoke `codex exec` recursively.
3. Prefer `node scripts/create-blog-source.js "<notion-url>"` when the user provides a Notion page URL.
4. Accept `node scripts/create-blog-source.js "<page-id>"` when the user provides a page id.
5. Accept `node scripts/create-blog-source.js "<path>"` when the user provides a page path.
6. If the user did not provide a source URL, page id, or path and page-tree mode is configured, run `node scripts/list-notion-tree.js` and choose a path with the user.
7. Read `output/create-blog-source.md` and `output/create-blog-source.json`.
8. Read `templates/tistory-blog-draft.md` and follow it when drafting the final article.
9. Draft a blog post from the pulled source without inventing facts that are not in the note.
10. Save the final article to `output/create-blog.md`.
11. If `NOTION_BLOG_TARGET_PAGE_ID` is configured, run `node scripts/publish-blog-draft.js` after writing the draft.
12. Report the source title, source page id, source path if used, draft output path, and published page URL when present.

## Writing Rules

- Default to Korean unless the source note clearly targets another language.
- Preserve the original argument, examples, and factual claims.
- Improve structure, transitions, headline wording, and conclusion as needed.
- If the source note is missing a critical fact, call out the gap instead of guessing.

## Preferred Article Pattern

Follow the article shape extracted from the user's preferred example.

1. Start with a short problem hook:
   - Introduce the topic simply.
   - Explain why frontend or practical developers should care.
   - Name the pain point before introducing the solution.
2. Explain the existing concept or common approach first:
   - Example: explain the spread operator before introducing Immer.
   - Show why the common approach becomes hard to read or maintain.
3. Introduce the main tool or concept as the solution:
   - Use a natural, slightly conversational section title when it fits.
   - Example patterns: `{개념}?`, `{도구}? 넌 누구냐`, `왜 이게 필요한가`
4. Explain the working principle:
   - Break down the internal mechanism in plain language.
   - If a function or key concept exists, explain it separately.
5. Explain how to use it:
   - Installation
   - Basic usage
   - Real-world or framework example
6. Add caution points:
   - Mention practical pitfalls in a short dedicated section.
7. Close with a recommendation:
   - Reinforce when and why the tool is worth using.

## Style Pattern

- Write like a technical blog post, not like notes pasted as-is.
- Keep the tone soft and explanatory.
- Use natural connectors such as `개발을 하다 보면`, `쉽게 말하면`, and `정리하면`.
- When the source is about a library, API, or framework feature, prefer this narrative:
  - what problem appears in practice
  - why the existing way is awkward
  - what the new tool solves
  - how it works
  - how to use it
  - what to watch out for
- After showing a code block, briefly explain what the reader should notice in that code.
- Favor section headings that are readable and slightly conversational over dry textbook headings when it fits the topic.

## Safety Rules

- Do not modify the pulled source artifacts except by re-running the pull script.
- If the Notion script fails, report the missing environment variable or schema mismatch directly.
- Keep generated files inside `output/`.
