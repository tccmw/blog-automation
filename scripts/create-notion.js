#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const {
  appendBlockChildren,
  archiveBlock,
  createPage,
  fetchBlockTree,
  getNotionConfig,
  validateToken,
} = require("./lib/notion-api");
const { extractTitleAndBody, markdownToNotionBlocks } = require("./lib/notion-render");
const { pullWorkflowSource, writeWorkflowArtifacts } = require("./lib/notion-workflows");
const { parseSourceInput } = require("./lib/parse-source-input");

const ORIGINAL_PAGE_LABEL = "\uC6D0\uBCF8";
const ORGANIZED_PAGE_LABEL = "\uC815\uB9AC\uBCF8";

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
  const handoffPath = path.join(workspaceRoot, "output", "create-notion-codex-prompt.md");
  const codexResultPath = path.join(workspaceRoot, "output", "create-notion-codex-result.txt");
  const codexLogPath = path.join(workspaceRoot, "output", "create-notion-codex.log");
  const resultPath = path.join(workspaceRoot, "output", "create-notion-result.json");

  console.log(`Saved "${result.metadata.sourceTitle}" source to ${paths.markdownPath}`);

  await writeCodexHandoff({
    handoffPath,
    draftPath,
    result,
    paths,
    templatePath,
  });
  console.log("Generating Notion-ready rewrite with Codex CLI.");
  console.log(`Saved Codex handoff prompt to ${handoffPath}`);

  await runCodexRewrite({
    workspaceRoot,
    result,
    paths,
    templatePath,
    draftPath,
    codexResultPath,
    codexLogPath,
  });

  await assertFileExists(draftPath, "Codex finished but did not write output/create-notion.md.");
  const organizedMarkdown = normalizeChildPageMarkdown(await fs.readFile(draftPath, "utf8"));

  await fs.mkdir(path.dirname(draftPath), { recursive: true });
  await fs.writeFile(draftPath, organizedMarkdown, "utf8");

  const created = await createRewritePages({
    parentPageId: result.metadata.sourceId,
    parentPageUrl: result.metadata.sourceUrl,
    parentTitle: result.metadata.sourceTitle,
    organizedMarkdown,
    draftPath,
    sourceMarkdownPath: paths.markdownPath,
    sourceMetaPath: paths.metadataPath,
    resultPath,
  });

  console.log(`Saved Notion-ready rewrite to ${draftPath}`);
  console.log(`Saved Codex run log to ${codexLogPath}`);
  console.log(`Created original child page at ${created.originalPageUrl || created.originalPageId}`);
  console.log(`Created organized child page at ${created.organizedPageUrl || created.organizedPageId}`);
}

async function writeCodexHandoff({ handoffPath, draftPath, result, paths, templatePath }) {
  const content = [
    "# Create Notion Codex Handoff",
    "",
    "OpenAI API generation is disabled for this workflow.",
    "Use the local Codex CLI session to turn the pulled Notion source into the organized child page draft.",
    "",
    "## Source",
    `- Title: ${result.metadata.sourceTitle || "Untitled"}`,
    `- Page ID: ${result.metadata.sourceId || ""}`,
    `- URL: ${result.metadata.sourceUrl || ""}`,
    `- Source markdown: ${paths.markdownPath}`,
    `- Source metadata: ${paths.metadataPath}`,
    `- Writing template: ${templatePath}`,
    `- Output draft: ${draftPath}`,
    "",
    "## Rules",
    "- Preserve the source meaning, factual claims, and important structure.",
    "- Improve clarity, order, headings, and scanability for Notion.",
    "- Use Markdown structures that convert cleanly to Notion blocks.",
    "- Do not add a top-level `#` title; the child page title is set separately.",
    "- Write only the organized child page body to `output/create-notion.md`.",
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(handoffPath), { recursive: true });
  await fs.writeFile(handoffPath, content, "utf8");
}

async function runCodexRewrite({
  workspaceRoot,
  result,
  paths,
  templatePath,
  draftPath,
  codexResultPath,
  codexLogPath,
}) {
  const prompt = buildCodexPrompt({
    result,
    paths,
    templatePath,
    draftPath,
  });

  await fs.mkdir(path.dirname(codexResultPath), { recursive: true });
  await fs.mkdir(path.dirname(codexLogPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(
      "codex",
      [
        "exec",
        "--full-auto",
        "--cd",
        workspaceRoot,
        "--output-last-message",
        codexResultPath,
        "--color",
        "never",
        "-",
      ],
      {
        cwd: workspaceRoot,
        stdio: ["pipe", "pipe", "pipe"],
        env: buildCodexCliEnv(process.env),
        shell: process.platform === "win32",
      },
    );

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    child.on("error", (error) => {
      writeCodexLog(codexLogPath, stdoutChunks, stderrChunks)
        .catch(() => {})
        .finally(() => {
          reject(
            new Error(
              `Failed to start Codex CLI. Check 'codex login status' and PATH configuration. ${error.message}`,
            ),
          );
        });
    });

    child.on("exit", (code) => {
      writeCodexLog(codexLogPath, stdoutChunks, stderrChunks)
        .catch(() => {})
        .finally(() => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              `Codex CLI Notion rewrite failed with exit code ${code}. Review ${codexLogPath} and ${codexResultPath}, or rerun 'codex login status'.`,
            ),
          );
        });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function writeCodexLog(logPath, stdoutChunks, stderrChunks) {
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const content = [
    "# Codex stdout",
    stdout.trim(),
    "",
    "# Codex stderr",
    stderr.trim(),
    "",
  ].join("\n");

  await fs.writeFile(logPath, content, "utf8");
}

function buildCodexPrompt({ result, paths, templatePath, draftPath }) {
  const lines = [
    "You are organizing a pulled Notion page inside this repository.",
    `Read the pulled source markdown at: ${paths.markdownPath}`,
    `Read the source metadata at: ${paths.metadataPath}`,
    `Read the writing instructions at: ${templatePath}`,
    `Write the organized Notion-ready Markdown body to: ${draftPath}`,
    "Do not modify the source artifact files.",
    "Do not publish to Notion yourself.",
    "Do not run node scripts/create-notion.js.",
    "Do not add a top-level `#` title. The child page title is set by the parent script.",
    "Preserve the source meaning, factual claims, names, dates, links, and code snippets.",
    "Improve only structure, order, clarity, headings, formatting, and scanability.",
    "Use Markdown structures that convert cleanly to Notion blocks: headings, paragraphs, bullets, numbered lists, quotes, dividers, and fenced code blocks.",
    "Return only a short final message that reports the draft path.",
  ];

  if (result && result.metadata) {
    lines.push(
      `Source title: ${result.metadata.sourceTitle || "Untitled"}`,
      `Source URL: ${result.metadata.sourceUrl || ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildCodexCliEnv(env) {
  const nextEnv = { ...env };
  delete nextEnv.OPENAI_API_KEY;
  delete nextEnv.OPENAI_MODEL;
  delete nextEnv.OPENAI_MAX_OUTPUT_TOKENS;
  delete nextEnv.NOTION_API_KEY;
  delete nextEnv.NOTION_TOKEN;
  return nextEnv;
}

async function assertFileExists(filePath, message) {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(message);
  }
}

async function createRewritePages({
  parentPageId,
  parentPageUrl,
  parentTitle,
  organizedMarkdown,
  draftPath,
  sourceMarkdownPath,
  sourceMetaPath,
  resultPath,
  env = process.env,
}) {
  const notionConfig = getNotionConfig(env);
  validateToken(notionConfig);
  const currentParentBlocks = await fetchBlockTree(notionConfig, parentPageId);
  const originalBlocks = sanitizeBlocksForWrite(currentParentBlocks);
  if (!originalBlocks.length) {
    throw new Error(`No original Notion blocks found in ${sourceMarkdownPath}`);
  }

  const organizedBlocks = markdownToNotionBlocks(organizedMarkdown);
  if (!organizedBlocks.length) {
    throw new Error(`No organized Notion content found in ${draftPath}`);
  }

  const originalPageTitle = buildChildPageTitle(ORIGINAL_PAGE_LABEL, parentTitle);
  const organizedPageTitle = buildChildPageTitle(ORGANIZED_PAGE_LABEL, parentTitle);

  const originalPage = await createChildPageWithBlocks(notionConfig, {
    parentPageId,
    title: originalPageTitle,
    blocks: originalBlocks,
  });

  const organizedPage = await createChildPageWithBlocks(notionConfig, {
    parentPageId,
    title: organizedPageTitle,
    blocks: organizedBlocks,
  });

  await archiveBlocks(notionConfig, currentParentBlocks);

  const result = {
    createdAt: new Date().toISOString(),
    parentPageId,
    parentPageUrl: parentPageUrl || "",
    parentTitle: parentTitle || "Untitled",
    draftPath,
    sourceMarkdownPath,
    sourceMetaPath,
    originalPageId: originalPage.id,
    originalPageUrl: originalPage.url || "",
    originalPageTitle,
    originalBlockCount: originalBlocks.length,
    organizedPageId: organizedPage.id,
    organizedPageUrl: organizedPage.url || "",
    organizedPageTitle,
    organizedBlockCount: organizedBlocks.length,
    archivedParentBlockCount: currentParentBlocks.length,
  };

  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function createChildPageWithBlocks(notionConfig, { parentPageId, title, blocks }) {
  const firstChunk = blocks.slice(0, 100);
  const remainder = chunk(blocks.slice(100), 100);
  const page = await createPage(notionConfig, {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: title } }],
      },
    },
    children: firstChunk,
  });

  for (const blockGroup of remainder) {
    await appendBlockChildren(notionConfig, page.id, blockGroup);
  }

  return page;
}

function buildChildPageTitle(label, parentTitle) {
  const safeParentTitle = String(parentTitle || "Untitled").trim() || "Untitled";
  return `${label} - ${safeParentTitle}`;
}

function normalizeChildPageMarkdown(markdown) {
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

async function archiveBlocks(notionConfig, blocks) {
  for (const block of blocks || []) {
    await archiveBlock(notionConfig, block.id);
  }
}

function sanitizeBlocksForWrite(blocks) {
  return (blocks || [])
    .map(sanitizeBlockForWrite)
    .filter(Boolean);
}

function sanitizeBlockForWrite(block) {
  if (!block || !block.type) {
    return null;
  }

  const type = block.type;
  const data = block[type] || {};
  const children = block.children && block.children.length ? sanitizeBlocksForWrite(block.children) : undefined;

  switch (type) {
    case "paragraph":
      return {
        object: "block",
        type,
        paragraph: withOptionalChildren(
          {
            rich_text: sanitizeRichText(data.rich_text),
            color: data.color || "default",
          },
          children,
        ),
      };
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return {
        object: "block",
        type,
        [type]: withOptionalChildren(
          {
            rich_text: sanitizeRichText(data.rich_text),
            color: data.color || "default",
            is_toggleable: Boolean(data.is_toggleable),
          },
          children,
        ),
      };
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do":
    case "quote":
    case "toggle":
      return {
        object: "block",
        type,
        [type]: withOptionalChildren(
          {
            ...(type === "to_do" ? { checked: Boolean(data.checked) } : {}),
            rich_text: sanitizeRichText(data.rich_text),
            color: data.color || "default",
          },
          children,
        ),
      };
    case "divider":
      return {
        object: "block",
        type,
        divider: {},
      };
    case "code":
      return {
        object: "block",
        type,
        code: {
          rich_text: sanitizeRichText(data.rich_text),
          language: data.language || "plain text",
          caption: sanitizeRichText(data.caption),
        },
      };
    default: {
      const fallbackText = plainText(data.rich_text || data.caption || []);
      if (!fallbackText) {
        return null;
      }

      return {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: sanitizeRichText([
            {
              type: "text",
              text: { content: fallbackText },
            },
          ]),
          color: "default",
        },
      };
    }
  }
}

function sanitizeRichText(items) {
  return (items || [])
    .map((item) => {
      if (!item) {
        return null;
      }

      if (item.type === "text" || item.text) {
        const content = item.plain_text || item.text?.content || "";
        return {
          type: "text",
          text: {
            content,
            ...(item.href || item.text?.link?.url ? { link: { url: item.href || item.text?.link?.url } } : {}),
          },
          annotations: sanitizeAnnotations(item.annotations),
        };
      }

      const content =
        item.plain_text ||
        item.mention?.page?.id ||
        item.mention?.database?.id ||
        item.equation?.expression ||
        "";

      if (!content) {
        return null;
      }

      return {
        type: "text",
        text: { content },
        annotations: sanitizeAnnotations(item.annotations),
      };
    })
    .filter(Boolean);
}

function sanitizeAnnotations(annotations = {}) {
  return {
    bold: Boolean(annotations.bold),
    italic: Boolean(annotations.italic),
    strikethrough: Boolean(annotations.strikethrough),
    underline: Boolean(annotations.underline),
    code: Boolean(annotations.code),
    color: annotations.color || "default",
  };
}

function withOptionalChildren(blockData, children) {
  if (children && children.length) {
    return {
      ...blockData,
      children,
    };
  }

  return blockData;
}

function plainText(richText) {
  return (richText || []).map((item) => item?.plain_text || item?.text?.content || "").join("");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}
