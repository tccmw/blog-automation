#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const { appendBlockChildren, getNotionConfig, validateToken } = require("./lib/notion-api");
const { extractTitleAndBody, markdownToNotionBlocks } = require("./lib/notion-render");
const { pullWorkflowSource, writeWorkflowArtifacts } = require("./lib/notion-workflows");
const { generateMarkdownDraft } = require("./lib/openai-api");
const { parseSourceInput } = require("./lib/parse-source-input");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const sourceInput = process.argv.slice(2).join(" ").trim();
  const parsedInput = parseSourceInput(sourceInput);

  if (!parsedInput.sourcePageId && !parsedInput.sourcePath) {
    throw new Error("Missing source page URL, page id, or path for create-notion.");
  }

  const pulled = await pullWorkflowSource("blog", parsedInput);
  const result = {
    ...pulled,
    metadata: {
      ...pulled.metadata,
      workflow: "notion",
      outputStem: "create-notion",
    },
  };

  const paths = await writeWorkflowArtifacts(result);
  const templatePath = path.join(workspaceRoot, "templates", "notion-append-draft.md");
  const draftPath = path.join(workspaceRoot, "output", "create-notion.md");
  const resultPath = path.join(workspaceRoot, "output", "create-notion-result.json");

  console.log(`Saved "${result.metadata.sourceTitle}" source to ${paths.markdownPath}`);

  const instructions = await fs.readFile(templatePath, "utf8");
  const draft = await generateMarkdownDraft({
    instructions: [
      instructions,
      "",
      "Return only the final Markdown body to append below the original page.",
      "Do not wrap the entire response in code fences.",
    ].join("\n"),
    sourceMarkdown: result.markdown,
    sourceMeta: result.metadata,
  });

  const normalizedMarkdown = normalizeAppendMarkdown(draft.markdown);
  await fs.mkdir(path.dirname(draftPath), { recursive: true });
  await fs.writeFile(draftPath, normalizedMarkdown, "utf8");

  const appended = await appendRewriteToPage({
    targetPageId: result.metadata.sourceId,
    targetPageUrl: result.metadata.sourceUrl,
    targetTitle: result.metadata.sourceTitle,
    markdown: normalizedMarkdown,
    draftPath,
    sourceMetaPath: paths.metadataPath,
    resultPath,
  });

  console.log(`Saved Notion-ready rewrite to ${draftPath}`);
  console.log(`Appended organized content to ${appended.url || appended.pageId}`);
}

async function appendRewriteToPage({
  targetPageId,
  targetPageUrl,
  targetTitle,
  markdown,
  draftPath,
  sourceMetaPath,
  resultPath,
  env = process.env,
}) {
  const notionConfig = getNotionConfig(env);
  validateToken(notionConfig);

  const bodyBlocks = markdownToNotionBlocks(markdown);
  if (!bodyBlocks.length) {
    throw new Error(`No appendable Notion content found in ${draftPath}`);
  }

  const children = [{ object: "block", type: "divider", divider: {} }, ...bodyBlocks];
  const firstChunk = children.slice(0, 100);
  const remainder = chunk(children.slice(100), 100);

  await appendBlockChildren(notionConfig, targetPageId, firstChunk);

  for (const blockGroup of remainder) {
    await appendBlockChildren(notionConfig, targetPageId, blockGroup);
  }

  const result = {
    appendedAt: new Date().toISOString(),
    pageId: targetPageId,
    url: targetPageUrl || "",
    title: targetTitle || "Untitled",
    draftPath,
    sourceMetaPath,
    appendedBlockCount: children.length,
  };

  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function normalizeAppendMarkdown(markdown) {
  const value = String(markdown || "").trim();

  if (!value) {
    return "";
  }

  if (/^#\s+/.test(value)) {
    const { body } = extractTitleAndBody(value, "");
    return ensureTrailingNewline(body.trim() || value);
  }

  return ensureTrailingNewline(value);
}

function chunk(items, size) {
  const groups = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}
