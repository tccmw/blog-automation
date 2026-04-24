#!/usr/bin/env node

const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const { publishBlogDraft } = require("./lib/publish-blog-draft");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const result = await publishBlogDraft({
    targetInput: process.argv[2] || process.env.NOTION_BLOG_TARGET_PAGE_ID || "",
    inputPath: process.argv[3],
    sourceMetaPath: process.argv[4],
  });

  console.log(`Created blog draft page "${result.title}" at ${result.url || result.pageId}`);
}
