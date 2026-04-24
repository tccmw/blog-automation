#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const {
  appendBlockChildren,
  buildPropertyValue,
  createPage,
  fetchDatabaseSchema,
  findProperty,
  findTitlePropertyName,
  getNotionConfig,
  validateToken,
} = require("./lib/notion-api");
const { extractTitleAndBody, markdownToNotionBlocks } = require("./lib/notion-render");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(WORKSPACE_ROOT, "output", "create-linkedin.md");
const DEFAULT_SOURCE_META_PATH = path.join(WORKSPACE_ROOT, "output", "create-linkedin-source.json");
const DEFAULT_RESULT_PATH = path.join(WORKSPACE_ROOT, "output", "create-linkedin-published.json");
const TITLE_SUFFIX = process.env.NOTION_LINKEDIN_TITLE_SUFFIX || " - LinkedIn";

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const notionConfig = getNotionConfig(process.env);
  validateToken(notionConfig);

  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT_PATH);
  const sourceMetaPath = path.resolve(process.argv[3] || DEFAULT_SOURCE_META_PATH);
  const markdown = await fs.readFile(inputPath, "utf8");
  const sourceMeta = await readOptionalJson(sourceMetaPath);

  const defaultTitle = sourceMeta && sourceMeta.sourceTitle ? `${sourceMeta.sourceTitle}${TITLE_SUFFIX}` : "LinkedIn Draft";
  const { title, body } = extractTitleAndBody(markdown, defaultTitle);
  const bodyWithSource = prependSourceReference(body, sourceMeta);
  const blocks = markdownToNotionBlocks(bodyWithSource);

  if (!blocks.length) {
    throw new Error(`No publishable content found in ${inputPath}`);
  }

  const target = await buildTargetConfig(notionConfig, title);
  const firstChunk = blocks.slice(0, 100);
  const remainder = chunk(blocks.slice(100), 100);
  const createdPage = await createPage(notionConfig, {
    parent: target.parent,
    properties: target.properties,
    children: firstChunk,
  });

  for (const blockGroup of remainder) {
    await appendBlockChildren(notionConfig, createdPage.id, blockGroup);
  }

  const result = {
    createdAt: new Date().toISOString(),
    inputPath,
    sourceMetaPath,
    pageId: createdPage.id,
    url: createdPage.url || "",
    title,
  };

  await fs.mkdir(path.dirname(DEFAULT_RESULT_PATH), { recursive: true });
  await fs.writeFile(DEFAULT_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Created LinkedIn page "${title}" at ${createdPage.url || createdPage.id}`);
}

async function buildTargetConfig(notionConfig, title) {
  const targetPageId = process.env.NOTION_LINKEDIN_TARGET_PAGE_ID;
  const targetDatabaseId = process.env.NOTION_LINKEDIN_TARGET_DATABASE_ID;

  if (targetDatabaseId) {
    const schema = await fetchDatabaseSchema(notionConfig, targetDatabaseId);
    const titlePropertyName = findTitlePropertyName(schema.properties);

    if (!titlePropertyName) {
      throw new Error("Could not find a title property in the target Notion database.");
    }

    const properties = {
      [titlePropertyName]: buildPropertyValue(schema.properties, titlePropertyName, title),
    };

    const statusProperty = process.env.NOTION_LINKEDIN_TARGET_STATUS_PROPERTY;
    const statusValue = process.env.NOTION_LINKEDIN_TARGET_STATUS_VALUE;

    if (statusProperty && statusValue) {
      const matchedProperty = findProperty(schema.properties, statusProperty);

      if (!matchedProperty) {
        throw new Error(`Could not find target property "${statusProperty}" in the LinkedIn target database.`);
      }

      properties[matchedProperty.name] = buildPropertyValue(
        schema.properties,
        matchedProperty.name,
        statusValue,
      );
    }

    return {
      parent: { database_id: targetDatabaseId },
      properties,
    };
  }

  if (targetPageId) {
    return {
      parent: { page_id: targetPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
    };
  }

  throw new Error(
    "Missing NOTION_LINKEDIN_TARGET_PAGE_ID or NOTION_LINKEDIN_TARGET_DATABASE_ID.",
  );
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
