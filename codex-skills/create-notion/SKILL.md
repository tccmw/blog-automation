---
name: create-notion
description: Pull a Notion page, generate a cleaned Notion-ready rewrite, and restructure the source page into original and organized child pages. Use when the user writes "create-notion", asks to organize or clean up a Notion page, or wants Codex to turn an existing Notion page into original and organized child pages.
---

# Create Notion

Run this workflow when the user invokes `create-notion`.

## Goal

Read a selected Notion page from a Notion URL, page id, or page path, preserve its current content in an original child page, generate a cleaned rewrite in an organized child page, and turn the selected page into the parent container for those child pages.

This is a live Notion write workflow. It creates child pages under the selected source page and archives the source page's existing top-level blocks after copying them into the original child page.

## Required Flow

1. Verify that `scripts/create-notion.js` exists in the current repository.
2. Require an explicit Notion page URL, page id, or page path before running the workflow.
3. If the user did not provide a source URL, page id, or path and page-tree mode is configured, run `node scripts/list-notion-tree.js` and choose a page path with the user.
4. Do not run `scripts/create-notion.js` when the target page is ambiguous.
5. Run `node scripts/create-notion.js "<notion-url-or-page-id-or-path>"`.
6. Read `output/create-notion-result.json` after the script completes.
7. Report the source page, created original child page URL, created organized child page URL, archived parent block count, and local output paths.

## Environment

- `NOTION_API_KEY` or `NOTION_TOKEN` is required.
- `OPENAI_API_KEY` is required because the organized rewrite is generated through the OpenAI API.

## Writing Rules

- Default to Korean unless the source page clearly targets another language.
- Preserve the source meaning, factual claims, and important structure.
- Improve clarity, order, headings, and scanability for Notion.
- Use Markdown structures that convert cleanly to Notion blocks.
- Do not add a top-level `#` title to `output/create-notion.md`; the child page title is set separately.

## Safety Rules

- Treat this as a live mutation of the selected Notion page, not a draft-only workflow.
- Do not run the workflow without a clearly selected source page.
- Do not manually create, archive, or rewrite Notion blocks outside `scripts/create-notion.js`.
- Do not modify pulled source artifacts except by re-running the script.
- Keep generated files inside `output/`.
- If the script fails, report the missing environment variable, source selection issue, OpenAI error, or Notion API error directly.
