---
name: create-linkedin
description: Pull a ready source note from Notion, draft a LinkedIn-ready summary in a fixed structure, and optionally publish that result into another Notion page. Use when the user writes "create-linkedin", asks to turn a Notion note into a LinkedIn post, or wants Codex to organize a source note into a target Notion page.
---

# Create LinkedIn

Run this workflow when the user invokes `create-linkedin`.

## Goal

Read a selected Notion source note from a Notion URL, page id, page path, or database workflow, draft a consistent LinkedIn package, save it to `output/create-linkedin.md`, and publish it into a target Notion page when target credentials are configured.

## Required Flow

1. Verify that `scripts/create-linkedin.js` exists in the current repository.
2. Prefer `node scripts/create-linkedin.js "<notion-url>"` when the user provides a Notion page URL.
3. Accept `node scripts/create-linkedin.js "<page-id>"` when the user provides a page id.
4. Accept `node scripts/create-linkedin.js "<path>"` when the user provides a page path.
5. If the user did not provide a source URL, page id, or path and page-tree mode is configured, run `node scripts/list-notion-tree.js` and choose a path with the user.
6. Read `output/create-linkedin-source.md` and `output/create-linkedin-source.json`.
7. Draft the final content in this structure:
   - `# {title}`
   - `## Hook`
   - `## LinkedIn Post`
   - `## Key Points`
   - `## CTA`
8. Save the final markdown to `output/create-linkedin.md`.
9. If `NOTION_LINKEDIN_TARGET_PAGE_ID` or `NOTION_LINKEDIN_TARGET_DATABASE_ID` is configured, run `node scripts/publish-linkedin.js`.
10. Report the source page, source path if used, local output path, and published page URL if one was created.

## Writing Rules

- Default to Korean unless the source note clearly targets another language.
- Keep the LinkedIn post concise enough to publish directly.
- Preserve factual claims from the source note and tighten phrasing for scanability.
- Use `Key Points` for short bullets, not dense prose.

## Safety Rules

- Do not publish anything until `output/create-linkedin.md` exists and has been reviewed in the current turn.
- If the target Notion page or database is not configured, stop after saving the markdown draft and report the missing target variable.
- Keep generated files inside `output/`.
