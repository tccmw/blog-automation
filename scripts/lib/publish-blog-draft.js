const fs = require("fs/promises");
const path = require("path");

const {
  appendBlockChildren,
  createPage,
  getNotionConfig,
  validateToken,
} = require("./notion-api");
const { extractTitleAndBody, markdownToNotionBlocks } = require("./notion-render");
const { extractPageId } = require("./parse-source-input");

async function publishBlogDraft(options = {}) {
  const env = options.env || process.env;
  const notionConfig = getNotionConfig(env);
  validateToken(notionConfig);

  const workspaceRoot = options.workspaceRoot || path.resolve(__dirname, "..", "..");
  const targetInput = options.targetInput || env.NOTION_BLOG_TARGET_PAGE_ID || "";
  const inputPath = path.resolve(options.inputPath || path.join(workspaceRoot, "output", "create-blog.md"));
  const sourceMetaPath = path.resolve(
    options.sourceMetaPath || path.join(workspaceRoot, "output", "create-blog-source.json"),
  );
  const resultPath = path.resolve(
    options.resultPath || path.join(workspaceRoot, "output", "create-blog-published.json"),
  );
  const targetPageId = extractPageId(targetInput);

  if (!targetPageId) {
    throw new Error("Missing target page id or Notion page URL for the blog draft.");
  }

  const markdown = await fs.readFile(inputPath, "utf8");
  const sourceMeta = await readOptionalJson(sourceMetaPath);
  const { title, body } = extractTitleAndBody(markdown, "Blog Draft");
  const bodyWithSource = prependSourceReference(body, sourceMeta);
  const blocks = markdownToNotionBlocks(bodyWithSource);

  if (!blocks.length) {
    throw new Error(`No publishable blog content found in ${inputPath}`);
  }

  const firstChunk = blocks.slice(0, 100);
  const remainder = chunk(blocks.slice(100), 100);
  const createdPage = await createPage(notionConfig, {
    parent: { page_id: targetPageId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: title } }],
      },
    },
    children: firstChunk,
  });

  for (const blockGroup of remainder) {
    await appendBlockChildren(notionConfig, createdPage.id, blockGroup);
  }

  const result = {
    createdAt: new Date().toISOString(),
    inputPath,
    sourceMetaPath,
    parentPageId: targetPageId,
    pageId: createdPage.id,
    url: createdPage.url || "",
    title,
  };

  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function prependSourceReference(body, sourceMeta) {
  if (!sourceMeta || !sourceMeta.sourceTitle) {
    return body;
  }

  const sourceLine = sourceMeta.sourceUrl
    ? `Source: ${sourceMeta.sourceTitle} (${sourceMeta.sourceUrl})`
    : `Source: ${sourceMeta.sourceTitle}`;

  return [sourceLine, "", body].filter(Boolean).join("\n");
}

function chunk(items, size) {
  const groups = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
}

async function readOptionalJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

module.exports = {
  publishBlogDraft,
};
