#!/usr/bin/env node

const { loadLocalEnv } = require("./lib/load-env");

loadLocalEnv();

const { parseSourceInput } = require("./lib/parse-source-input");
const { pullWorkflowSource, writeWorkflowArtifacts } = require("./lib/notion-workflows");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const sourceInput = process.argv.slice(2).join(" ").trim();
  const result = await pullWorkflowSource("blog", parseSourceInput(sourceInput));
  const paths = await writeWorkflowArtifacts(result);

  console.log(`Saved "${result.metadata.sourceTitle}" source to ${paths.markdownPath}`);
}
