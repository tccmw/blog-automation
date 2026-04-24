const https = require("https");

function getNotionConfig(env = process.env) {
  const notionToken = env.NOTION_API_KEY || env.NOTION_TOKEN;
  const sourceId = env.NOTION_DATA_SOURCE_ID || env.NOTION_DATABASE_ID;
  const sourceKind = env.NOTION_DATA_SOURCE_ID
    ? "data_source"
    : env.NOTION_DATABASE_ID
      ? "database"
      : null;
  const notionVersion =
    env.NOTION_VERSION || (sourceKind === "data_source" ? "2025-09-03" : "2022-06-28");

  return {
    notionToken,
    sourceId,
    sourceKind,
    notionVersion,
  };
}

function validateSourceConfig(config) {
  validateToken(config);

  if (!config.sourceKind || !config.sourceId) {
    throw new Error("Missing NOTION_DATA_SOURCE_ID or NOTION_DATABASE_ID.");
  }
}

function validateToken(config) {
  if (!config || !config.notionToken) {
    throw new Error("Missing NOTION_API_KEY (or NOTION_TOKEN).");
  }
}

async function fetchSourceSchema(config) {
  const resourcePath =
    config.sourceKind === "data_source"
      ? `/v1/data_sources/${config.sourceId}`
      : `/v1/databases/${config.sourceId}`;

  return notionRequest(config, {
    method: "GET",
    resourcePath,
  });
}

async function querySourcePages(config, body) {
  const resourcePath =
    config.sourceKind === "data_source"
      ? `/v1/data_sources/${config.sourceId}/query`
      : `/v1/databases/${config.sourceId}/query`;

  return notionRequest(config, {
    method: "POST",
    resourcePath,
    body,
  });
}

async function fetchDatabaseSchema(config, databaseId) {
  return notionRequest(config, {
    method: "GET",
    resourcePath: `/v1/databases/${databaseId}`,
  });
}

async function fetchPage(config, pageId) {
  return notionRequest(config, {
    method: "GET",
    resourcePath: `/v1/pages/${pageId}`,
  });
}

async function searchPages(config, body = {}) {
  return notionRequest(config, {
    method: "POST",
    resourcePath: "/v1/search",
    body: {
      filter: {
        property: "object",
        value: "page",
      },
      page_size: 100,
      ...body,
    },
  });
}

async function fetchAllAccessiblePages(config) {
  const pages = [];
  let nextCursor = null;

  do {
    const response = await searchPages(config, nextCursor ? { start_cursor: nextCursor } : {});
    pages.push(...(response.results || []).filter((item) => item.object === "page"));
    nextCursor = response.has_more ? response.next_cursor : null;
  } while (nextCursor);

  return pages;
}

async function fetchBlockTree(config, blockId) {
  const blocks = await fetchBlockChildren(config, blockId);

  for (const block of blocks) {
    if (block.has_children) {
      block.children = await fetchBlockTree(config, block.id);
    }
  }

  return blocks;
}

async function fetchBlockChildren(config, blockId) {
  const blocks = [];
  let nextCursor = null;

  do {
    const query = new URLSearchParams({ page_size: "100" });

    if (nextCursor) {
      query.set("start_cursor", nextCursor);
    }

    const response = await notionRequest(config, {
      method: "GET",
      resourcePath: `/v1/blocks/${blockId}/children?${query.toString()}`,
    });

    blocks.push(...(response.results || []));
    nextCursor = response.has_more ? response.next_cursor : null;
  } while (nextCursor);

  return blocks;
}

async function createPage(config, payload) {
  return notionRequest(config, {
    method: "POST",
    resourcePath: "/v1/pages",
    body: payload,
  });
}

async function appendBlockChildren(config, blockId, children) {
  return notionRequest(config, {
    method: "PATCH",
    resourcePath: `/v1/blocks/${blockId}/children`,
    body: { children },
  });
}

function buildPropertyFilter(properties, logicalName, expectedValue) {
  if (expectedValue === undefined || expectedValue === null || String(expectedValue).trim() === "") {
    return null;
  }

  const property = findProperty(properties, logicalName);

  if (!property) {
    const available = Object.keys(properties || {}).join(", ");
    throw new Error(`Could not find "${logicalName}" property in Notion source. Available: ${available}`);
  }

  const propertyId = property.id || property.name;

  switch (property.type) {
    case "status":
      return { property: propertyId, status: { equals: expectedValue } };
    case "select":
      return { property: propertyId, select: { equals: expectedValue } };
    case "multi_select":
      return { property: propertyId, multi_select: { contains: expectedValue } };
    case "rich_text":
      return { property: propertyId, rich_text: { equals: expectedValue } };
    case "title":
      return { property: propertyId, title: { equals: expectedValue } };
    case "checkbox":
      return {
        property: propertyId,
        checkbox: { equals: String(expectedValue).toLowerCase() === "true" },
      };
    case "url":
      return { property: propertyId, url: { equals: expectedValue } };
    default:
      throw new Error(
        `Property "${property.name}" uses unsupported filter type "${property.type}" for this workflow.`,
      );
  }
}

function buildPropertyValue(properties, logicalName, value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const property = findProperty(properties, logicalName);

  if (!property) {
    const available = Object.keys(properties || {}).join(", ");
    throw new Error(`Could not find "${logicalName}" property in Notion target. Available: ${available}`);
  }

  switch (property.type) {
    case "title":
      return { title: richTextFromPlainText(value) };
    case "status":
      return { status: { name: String(value) } };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select":
      return {
        multi_select: String(value)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      };
    case "rich_text":
      return { rich_text: richTextFromPlainText(value) };
    case "checkbox":
      return { checkbox: String(value).toLowerCase() === "true" };
    case "url":
      return { url: String(value) };
    default:
      throw new Error(
        `Property "${property.name}" uses unsupported target type "${property.type}" for automated writes.`,
      );
  }
}

function findProperty(properties, logicalName) {
  const normalizedTarget = normalizeName(logicalName);

  return Object.entries(properties || {})
    .map(([name, schema]) => ({
      ...schema,
      name: schema.name || name,
    }))
    .find((property) => normalizeName(property.name) === normalizedTarget);
}

function findTitlePropertyName(properties) {
  const match = Object.entries(properties || {}).find(([, property]) => property.type === "title");
  return match ? match[0] : null;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function richTextFromPlainText(value) {
  const text = String(value || "");

  if (!text) {
    return [];
  }

  const chunks = [];

  for (let index = 0; index < text.length; index += 2000) {
    chunks.push({
      type: "text",
      text: { content: text.slice(index, index + 2000) },
    });
  }

  return chunks;
}

function notionRequest(config, { method, resourcePath, body }) {
  validateToken(config);

  const requestBody = body ? JSON.stringify(body) : null;
  const url = new URL(`https://api.notion.com${resourcePath}`);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${config.notionToken}`,
          "Notion-Version": config.notionVersion || "2022-06-28",
          "Content-Type": "application/json",
          ...(requestBody ? { "Content-Length": Buffer.byteLength(requestBody) } : {}),
        },
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const json = rawBody ? tryParseJson(rawBody) : {};

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(json);
            return;
          }

          const message =
            (json && json.message) ||
            `Notion API request failed with status ${response.statusCode}.`;

          reject(new Error(message));
        });
      },
    );

    request.on("error", reject);

    if (requestBody) {
      request.write(requestBody);
    }

    request.end();
  });
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return { message: value };
  }
}

module.exports = {
  appendBlockChildren,
  buildPropertyFilter,
  buildPropertyValue,
  createPage,
  fetchAllAccessiblePages,
  fetchBlockTree,
  fetchDatabaseSchema,
  fetchPage,
  fetchSourceSchema,
  findProperty,
  findTitlePropertyName,
  getNotionConfig,
  normalizeName,
  querySourcePages,
  richTextFromPlainText,
  validateSourceConfig,
  validateToken,
};
