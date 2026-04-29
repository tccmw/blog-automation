#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const { generateMarkdownDraft } = require("./lib/openai-api");
const { parseSourceInput } = require("./lib/parse-source-input");
const { publishBlogDraft } = require("./lib/publish-blog-draft");
const { pullWorkflowSource, writeWorkflowArtifacts } = require("./lib/notion-workflows");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const sourceInput = process.argv.slice(2).join(" ").trim();
  const result = await pullWorkflowSource("blog", parseSourceInput(sourceInput));
  const paths = await writeWorkflowArtifacts(result);
  const draftPath = path.join(workspaceRoot, "output", "create-blog.md");
  const handoffPath = path.join(workspaceRoot, "output", "create-blog-codex-prompt.md");
  const codexResultPath = path.join(workspaceRoot, "output", "create-blog-codex-result.txt");
  const codexLogPath = path.join(workspaceRoot, "output", "create-blog-codex.log");
  const draftMode = getDraftMode();

  console.log(`Saved "${result.metadata.sourceTitle}" source to ${paths.markdownPath}`);

  if (!shouldUseOpenAI()) {
    await writeCodexHandoff({
      handoffPath,
      draftPath,
      result,
      paths,
      workspaceRoot,
    });
    if (draftMode === "openai" && !hasOpenAIKey()) {
      console.log("BLOG_DRAFT_MODE=openai was requested, but OPENAI_API_KEY is not configured. Falling back to Codex.");
    } else {
      console.log("Generating draft with Codex CLI.");
    }
    console.log(`Saved Codex handoff prompt to ${handoffPath}`);

    await runCodexDraft({
      workspaceRoot,
      result,
      paths,
      draftPath,
      codexResultPath,
      codexLogPath,
    });

    await assertFileExists(draftPath, "Codex finished but did not write output/create-blog.md.");
    console.log(`Saved blog draft to ${draftPath}`);
    console.log(`Saved Codex run log to ${codexLogPath}`);

    let published = null;

    if (process.env.NOTION_BLOG_TARGET_PAGE_ID) {
      published = await publishBlogDraft({
        targetInput: process.env.NOTION_BLOG_TARGET_PAGE_ID,
        inputPath: draftPath,
        sourceMetaPath: paths.metadataPath,
        workspaceRoot,
      });
    }

    if (published) {
      console.log(`Published blog draft page to ${published.url || published.pageId}`);
    }

    return;
  }

  const instructions = await fs.readFile(
    path.join(workspaceRoot, "templates", "tistory-blog-draft.md"),
    "utf8",
  );
  const draft = await generateMarkdownDraft({
    instructions: `${instructions}\n\nReturn only the final Markdown article. Do not wrap it in code fences.`,
    sourceMarkdown: result.markdown,
    sourceMeta: result.metadata,
  });

  await fs.mkdir(path.dirname(draftPath), { recursive: true });
  await fs.writeFile(draftPath, draft.markdown, "utf8");

  let published = null;

  if (process.env.NOTION_BLOG_TARGET_PAGE_ID) {
    published = await publishBlogDraft({
      targetInput: process.env.NOTION_BLOG_TARGET_PAGE_ID,
      inputPath: draftPath,
      sourceMetaPath: paths.metadataPath,
      workspaceRoot,
    });
  }

  console.log(`Saved blog draft to ${draftPath}`);

  if (published) {
    console.log(`Published blog draft page to ${published.url || published.pageId}`);
  }
}

function hasOpenAIKey(env = process.env) {
  return Boolean(String(env.OPENAI_API_KEY || "").trim());
}

function getDraftMode(env = process.env) {
  return String(env.BLOG_DRAFT_MODE || "codex").trim().toLowerCase() === "openai" ? "openai" : "codex";
}

function shouldUseOpenAI(env = process.env) {
  return getDraftMode(env) === "openai" && hasOpenAIKey(env);
}

async function writeCodexHandoff({ handoffPath, draftPath, result, paths, workspaceRoot }) {
  const templatePath = path.join(workspaceRoot, "templates", "tistory-blog-draft.md");
  const content = [
    "# Create Blog Codex Handoff",
    "",
    "OpenAI API generation is disabled for this workspace.",
    "Use the current Codex session to turn the pulled Notion source into the final draft.",
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
    "## Codex Prompt",
    "Use the `create-blog` skill or ask Codex to:",
    "1. Read the source markdown and metadata.",
    "2. Follow the Tistory draft template.",
    "3. Write the final article to `output/create-blog.md` and use Markdown bold (`**text**`) for key ideas and takeaways.",
    "4. If `NOTION_BLOG_TARGET_PAGE_ID` is configured, run `npm run publish-blog-draft` after writing the draft.",
    "",
    "Suggested prompt:",
    "",
    "```text",
    "create-blog",
    "```",
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(handoffPath), { recursive: true });
  await fs.writeFile(handoffPath, content, "utf8");
}

async function runCodexDraft({ workspaceRoot, result, paths, draftPath, codexResultPath, codexLogPath }) {
  const prompt = buildCodexPrompt({ result, paths, draftPath });

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
        env: process.env,
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
              `Codex CLI draft generation failed with exit code ${code}. Review ${codexLogPath} and ${codexResultPath}, or rerun 'codex login status'.`,
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

function buildCodexPrompt({ result, paths, draftPath }) {
  const lines = [
    "You are drafting a Korean Tistory-ready technical blog post inside this repository.",
    `Read the pulled source markdown at: ${paths.markdownPath}`,
    `Read the source metadata at: ${paths.metadataPath}`,
    "Read the writing instructions at: templates/tistory-blog-draft.md",
    `Write the final article to: ${draftPath}`,
    "Do not modify the source artifact files.",
    "Preserve the source meaning. Improve only structure, tone, readability, and formatting.",
    "Output must be Markdown suitable for immediate posting.",
    "Use Markdown bold (`**text**`) for key concepts, important contrasts, and section takeaways without overusing it.",
    "Do not publish to Notion yourself.",
    "Do not run node scripts/publish-blog-draft.js.",
    "In your final response, report the draft path only.",
  ];

  if (result && result.metadata) {
    lines.push(
      `Source title: ${result.metadata.sourceTitle || "Untitled"}`,
      `Source URL: ${result.metadata.sourceUrl || ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function assertFileExists(filePath, message) {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(message);
  }
}
