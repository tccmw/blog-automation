#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const { listPageTree } = require("./lib/notion-workflows");

const OUTPUT_DIR = path.resolve(__dirname, "..", "output");
const TEXT_OUTPUT_PATH = path.join(OUTPUT_DIR, "notion-tree.txt");
const JSON_OUTPUT_PATH = path.join(OUTPUT_DIR, "notion-tree.json");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  const result = await listPageTree(parsed);
  const text = result.paths
    .map((item) => `${"  ".repeat(item.depth)}- ${item.path} [${item.id}]`)
    .join("\n");

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(TEXT_OUTPUT_PATH, `${text}\n`, "utf8");
  await fs.writeFile(JSON_OUTPUT_PATH, `${JSON.stringify(result.paths, null, 2)}\n`, "utf8");

  console.log(text);
  console.log(`\nSaved tree to ${TEXT_OUTPUT_PATH}`);
}

function parseArgs(args) {
  const result = {
    rootPageId: process.env.NOTION_ROOT_PAGE_ID || "",
    sourcePath: "",
    maxDepth: undefined,
  };

  for (const arg of args) {
    if (!arg) {
      continue;
    }

    if (isUuidLike(arg)) {
      result.rootPageId = arg;
      continue;
    }

    if (/^\d+$/.test(arg)) {
      result.maxDepth = Number.parseInt(arg, 10);
      continue;
    }

    result.sourcePath = arg;
  }

  return result;
}

function isUuidLike(value) {
  return /^[0-9a-f]{32}$/i.test(value) || /^[0-9a-f-]{36}$/i.test(value);
}
