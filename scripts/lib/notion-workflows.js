const fs = require("fs/promises");
const path = require("path");

const {
  buildPropertyFilter,
  fetchBlockTree,
  fetchPage,
  fetchSourceSchema,
  getNotionConfig,
  normalizeName,
  querySourcePages,
  validateSourceConfig,
  validateToken,
} = require("./notion-api");
const { renderDocument } = require("./notion-render");

const READY_STATUS_PROPERTY = process.env.NOTION_STATUS_PROPERTY || "status";
const TYPE_PROPERTY = process.env.NOTION_TYPE_PROPERTY || "type";
const PLATFORM_PROPERTY = process.env.NOTION_PLATFORM_PROPERTY || "platform";

const WORKFLOWS = {
  blog: {
    outputStem: "create-blog",
    typeValue: process.env.NOTION_BLOG_TYPE_VALUE || "blog",
    platformValue: process.env.NOTION_BLOG_PLATFORM_VALUE || "",
    sourcePageId: process.env.NOTION_BLOG_SOURCE_PAGE_ID || "",
    sourcePath: process.env.NOTION_BLOG_SOURCE_PATH || "",
  },
  linkedin: {
    outputStem: "create-linkedin",
    typeValue: process.env.NOTION_LINKEDIN_TYPE_VALUE || "linkedin",
    platformValue: process.env.NOTION_LINKEDIN_PLATFORM_VALUE || "",
    sourcePageId: process.env.NOTION_LINKEDIN_SOURCE_PAGE_ID || "",
    sourcePath: process.env.NOTION_LINKEDIN_SOURCE_PATH || "",
  },
};

async function pullWorkflowSource(workflowName, options = {}) {
  const env = options.env || process.env;
  const workflow = getWorkflowDefinition(workflowName, env, options);
  const notionConfig = getNotionConfig(env);
  validateToken(notionConfig);

  const source = await resolveWorkflowSource(notionConfig, workflow, env);
  const blocks = await fetchBlockTree(notionConfig, source.page.id);
  const title = getPageTitle(source.page);
  const markdown = renderDocument(title, blocks);

  return {
    markdown,
    metadata: {
      workflow: workflowName,
      outputStem: workflow.outputStem,
      sourceId: source.page.id,
      sourceUrl: source.page.url || "",
      sourceTitle: title,
      sourceKind: source.kind,
      pulledAt: new Date().toISOString(),
      sourcePath: source.path || "",
      rootPageId: source.rootPageId || "",
      filters: source.filters || null,
    },
  };
}

async function writeWorkflowArtifacts(result, outputDir = path.resolve(__dirname, "..", "..", "output")) {
  const markdownPath = path.join(outputDir, `${result.metadata.outputStem}-source.md`);
  const metadataPath = path.join(outputDir, `${result.metadata.outputStem}-source.json`);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(markdownPath, ensureTrailingNewline(result.markdown), "utf8");
  await fs.writeFile(metadataPath, `${JSON.stringify(result.metadata, null, 2)}\n`, "utf8");

  return { markdownPath, metadataPath };
}

async function listPageTree(options = {}) {
  const env = options.env || process.env;
  const notionConfig = getNotionConfig(env);
  validateToken(notionConfig);

  const rootPageId = options.rootPageId || env.NOTION_ROOT_PAGE_ID;
  const sourcePath = options.sourcePath || "";
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : getListTreeDepthLimit(env);

  if (!rootPageId) {
    throw new Error("Missing NOTION_ROOT_PAGE_ID.");
  }

  const startNode = sourcePath
    ? await resolvePageByPath(notionConfig, rootPageId, sourcePath)
    : { page: await fetchPage(notionConfig, rootPageId), path: "" };
  const tree = await buildReferencedPageTree(notionConfig, startNode.page.id, {
    maxDepth,
  });
  const rootPage = tree.page;

  if (!tree) {
    throw new Error(`Could not build a page tree from root page ${rootPageId}.`);
  }

  return {
    rootPage,
    tree,
    paths: flattenPageTree(tree),
  };
}

function getWorkflowDefinition(workflowName, env = process.env, options = {}) {
  switch (workflowName) {
    case "blog":
      return {
        outputStem: "create-blog",
        typeValue: env.NOTION_BLOG_TYPE_VALUE || WORKFLOWS.blog.typeValue,
        platformValue: env.NOTION_BLOG_PLATFORM_VALUE || "",
        sourcePageId: options.sourcePageId || env.NOTION_BLOG_SOURCE_PAGE_ID || "",
        sourcePath: options.sourcePath || env.NOTION_BLOG_SOURCE_PATH || "",
      };
    case "linkedin":
      return {
        outputStem: "create-linkedin",
        typeValue: env.NOTION_LINKEDIN_TYPE_VALUE || WORKFLOWS.linkedin.typeValue,
        platformValue: env.NOTION_LINKEDIN_PLATFORM_VALUE || "",
        sourcePageId: options.sourcePageId || env.NOTION_LINKEDIN_SOURCE_PAGE_ID || "",
        sourcePath: options.sourcePath || env.NOTION_LINKEDIN_SOURCE_PATH || "",
      };
    default:
      throw new Error(`Unknown workflow "${workflowName}". Expected one of: ${Object.keys(WORKFLOWS).join(", ")}`);
  }
}

async function resolveWorkflowSource(notionConfig, workflow, env) {
  if (workflow.sourcePageId) {
    return {
      kind: "page_id",
      page: await fetchPage(notionConfig, workflow.sourcePageId),
      path: "",
      rootPageId: "",
      filters: null,
    };
  }

  if (workflow.sourcePath) {
    const rootPageId = env.NOTION_ROOT_PAGE_ID;

    if (!rootPageId) {
      throw new Error("Path mode requires NOTION_ROOT_PAGE_ID.");
    }

    const resolved = await resolvePageByPath(notionConfig, rootPageId, workflow.sourcePath);
    return {
      kind: "page_path",
      page: resolved.page,
      path: resolved.path,
      rootPageId,
      filters: null,
    };
  }

  validateSourceConfig(notionConfig);

  const source = await fetchSourceSchema(notionConfig);
  const filters = [
    buildPropertyFilter(source.properties, READY_STATUS_PROPERTY, env.NOTION_READY_STATUS_VALUE || "Ready"),
    buildPropertyFilter(source.properties, TYPE_PROPERTY, workflow.typeValue),
    buildPropertyFilter(source.properties, PLATFORM_PROPERTY, workflow.platformValue),
  ].filter(Boolean);

  const page = await fetchReadyPage(notionConfig, filters);
  return {
    kind: notionConfig.sourceKind,
    page,
    path: "",
    rootPageId: "",
    filters: {
      status: env.NOTION_READY_STATUS_VALUE || "Ready",
      type: workflow.typeValue,
      platform: workflow.platformValue || "",
    },
  };
}

async function resolvePageByPath(notionConfig, rootPageId, requestedPath) {
  const pathSegments = normalizePathSegments(requestedPath);

  if (!pathSegments.length) {
    throw new Error("Source path is empty.");
  }

  const rootPage = await fetchPage(notionConfig, rootPageId);
  const rootTitle = getPageTitle(rootPage);
  const firstSegmentMatchesRoot = normalizeName(pathSegments[0]) === normalizeName(rootTitle);
  const relativeSegments = firstSegmentMatchesRoot ? pathSegments.slice(1) : pathSegments;
  let currentPage = rootPage;
  const resolvedSegments = [rootTitle];

  for (const segment of relativeSegments) {
    const children = await listReferencedPages(notionConfig, currentPage.id);
    const normalizedSegment = normalizeName(segment);
    const matches = children.filter((child) => normalizeName(child.title) === normalizedSegment);

    if (!matches.length) {
      const available = children.map((child) => child.title).join(", ");
      throw new Error(
        `Could not resolve path segment "${segment}" under "${getPageTitle(currentPage)}". Available: ${available || "(none)"}`,
      );
    }

    if (matches.length > 1) {
      throw new Error(`Path segment "${segment}" is ambiguous under "${getPageTitle(currentPage)}".`);
    }

    currentPage = matches[0].page;
    resolvedSegments.push(matches[0].title);
  }

  return {
    page: currentPage,
    path: resolvedSegments.join("/"),
  };
}

async function fetchReadyPage(notionConfig, filters) {
  const response = await querySourcePages(notionConfig, {
    filter: { and: filters },
    page_size: 100,
  });

  const candidates = (response.results || [])
    .filter((page) => page.object === "page")
    .filter((page) => !page.archived && !page.is_archived && !page.in_trash)
    .sort((left, right) => {
      const leftTime = new Date(left.created_time || left.last_edited_time || 0).getTime();
      const rightTime = new Date(right.created_time || right.last_edited_time || 0).getTime();
      return leftTime - rightTime;
    });

  if (!candidates.length) {
    const filterSummary = filters.map((filter) => JSON.stringify(filter)).join(", ");
    throw new Error(`No Notion page matched the configured filters. Filters: ${filterSummary}`);
  }

  return candidates[0];
}

async function buildReferencedPageTree(notionConfig, rootPageId, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 4;
  const pageCache = new Map();
  const blockCache = new Map();

  async function loadPage(pageId) {
    if (!pageCache.has(pageId)) {
      pageCache.set(pageId, fetchPage(notionConfig, pageId));
    }

    return pageCache.get(pageId);
  }

  async function loadBlocks(pageId) {
    if (!blockCache.has(pageId)) {
      blockCache.set(pageId, fetchBlockTree(notionConfig, pageId));
    }

    return blockCache.get(pageId);
  }

  async function buildNode(pageId, parent = null, ancestorIds = new Set(), depth = 0) {
    const page = await loadPage(pageId);
    const node = {
      page,
      title: getPageTitle(page),
      parent,
      children: [],
    };

    if (depth >= maxDepth) {
      return node;
    }

    const children = await listReferencedPages(notionConfig, pageId, {
      pageCache,
      blockCache,
    });

    for (const child of children) {
      if (ancestorIds.has(child.page.id) || child.page.id === pageId) {
        continue;
      }

      try {
        const nextAncestors = new Set(ancestorIds);
        nextAncestors.add(pageId);
        const childNode = await buildNode(child.page.id, node, nextAncestors, depth + 1);
        node.children.push(childNode);
      } catch (error) {
        continue;
      }
    }

    node.children.sort((left, right) => left.title.localeCompare(right.title, "ko"));
    return node;
  }

  return buildNode(rootPageId, null, new Set(), 0);
}

async function listReferencedPages(notionConfig, pageId, caches = {}) {
  const pageCache = caches.pageCache || new Map();
  const blockCache = caches.blockCache || new Map();

  async function loadPage(localPageId) {
    if (!pageCache.has(localPageId)) {
      pageCache.set(localPageId, fetchPage(notionConfig, localPageId));
    }

    return pageCache.get(localPageId);
  }

  async function loadBlocks(localPageId) {
    if (!blockCache.has(localPageId)) {
      blockCache.set(localPageId, fetchBlockTree(notionConfig, localPageId));
    }

    return blockCache.get(localPageId);
  }

  const blocks = await loadBlocks(pageId);
  const references = collectLinkedPageReferences(blocks);
  const uniquePageIds = Array.from(new Set(references.map((item) => item.pageId).filter(Boolean)));
  const children = [];

  for (const childPageId of uniquePageIds) {
    try {
      const page = await loadPage(childPageId);
      children.push({
        page,
        title: getPageTitle(page),
      });
    } catch (error) {
      continue;
    }
  }

  children.sort((left, right) => left.title.localeCompare(right.title, "ko"));
  return children;
}

function flattenPageTree(rootNode) {
  const lines = [];

  visitTree(rootNode, (node) => {
    lines.push({
      id: node.page.id,
      title: node.title,
      path: flattenNodePath(node),
      url: node.page.url || "",
      depth: getNodeDepth(node),
    });
  });

  return lines;
}

function visitTree(node, visitor) {
  visitor(node);
  for (const child of node.children) {
    visitTree(child, visitor);
  }
}

function flattenNodePath(node) {
  const segments = [];
  let current = node;

  while (current) {
    segments.push(current.title);
    current = current.parent;
  }

  return segments.reverse().join("/");
}

function getNodeDepth(node) {
  let depth = 0;
  let current = node.parent;

  while (current) {
    depth += 1;
    current = current.parent;
  }

  return depth;
}

function normalizePathSegments(sourcePath) {
  return String(sourcePath || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function collectLinkedPageReferences(blocks) {
  const references = [];

  for (const block of blocks || []) {
    collectReferencesFromValue(block, references);

    if (block.type === "child_page" && block.id) {
      references.push({ pageId: block.id, source: "child_page" });
    }

    if (block.type === "link_to_page") {
      const pageId = extractPageIdFromLinkToPage(block.link_to_page);

      if (pageId) {
        references.push({ pageId, source: "link_to_page" });
      }
    }
  }

  return references;
}

function collectReferencesFromValue(value, references) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencesFromValue(item, references);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (value.type === "mention" && value.mention && value.mention.type === "page" && value.mention.page) {
    references.push({ pageId: value.mention.page.id, source: "page_mention" });
  }

  const hrefPageId = extractPageIdFromUrl(value.href);
  if (hrefPageId) {
    references.push({ pageId: hrefPageId, source: "href" });
  }

  const urlPageId = extractPageIdFromUrl(value.url);
  if (urlPageId) {
    references.push({ pageId: urlPageId, source: "url" });
  }

  for (const childValue of Object.values(value)) {
    collectReferencesFromValue(childValue, references);
  }
}

function extractPageIdFromLinkToPage(linkToPage) {
  if (!linkToPage || typeof linkToPage !== "object") {
    return "";
  }

  if (linkToPage.type === "page_id" && linkToPage.page_id) {
    return linkToPage.page_id;
  }

  if (linkToPage.page_id) {
    return linkToPage.page_id;
  }

  return "";
}

function extractPageIdFromUrl(url) {
  const value = String(url || "");

  if (!/notion\.so/i.test(value)) {
    return "";
  }

  const hyphenated = value.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (hyphenated) {
    return hyphenated[1];
  }

  const compact = value.match(/([0-9a-f]{32})(?:\?|#|$)/i);
  if (compact) {
    const raw = compact[1];
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }

  return "";
}

function getTreeDepthLimit(env = process.env) {
  const parsed = Number.parseInt(env.NOTION_TREE_MAX_DEPTH || "4", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

function getListTreeDepthLimit(env = process.env) {
  const parsed = Number.parseInt(env.NOTION_TREE_LIST_DEPTH || "1", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function getPageTitle(page) {
  const titleProperty = Object.values(page.properties || {}).find((property) => property.type === "title");
  const title = titleProperty ? plainText(titleProperty.title) : "";

  return title || "Untitled";
}

function plainText(richText) {
  return (richText || []).map((item) => item.plain_text || "").join("");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

module.exports = {
  listPageTree,
  pullWorkflowSource,
  writeWorkflowArtifacts,
};
