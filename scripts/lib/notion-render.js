function renderDocument(title, blocks) {
  const body = renderBlocks(blocks).trim();

  if (!body) {
    return `# ${escapeMarkdownText(title)}`;
  }

  return [`# ${escapeMarkdownText(title)}`, body].join("\n\n");
}

function renderBlocks(blocks, depth = 0) {
  return (blocks || [])
    .map((block) => renderBlock(block, depth))
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

function renderBlock(block, depth) {
  const data = block[block.type] || {};

  switch (block.type) {
    case "paragraph":
      return withTrailingChildren(indentBlock(renderRichText(data.rich_text), depth), block.children, depth);
    case "heading_1":
      return withTrailingChildren(indentBlock(`# ${renderRichText(data.rich_text)}`, depth), block.children, depth);
    case "heading_2":
      return withTrailingChildren(indentBlock(`## ${renderRichText(data.rich_text)}`, depth), block.children, depth);
    case "heading_3":
      return withTrailingChildren(indentBlock(`### ${renderRichText(data.rich_text)}`, depth), block.children, depth);
    case "bulleted_list_item":
      return renderListItem("- ", data.rich_text, block.children, depth);
    case "numbered_list_item":
      return renderListItem("1. ", data.rich_text, block.children, depth);
    case "to_do":
      return renderListItem(data.checked ? "- [x] " : "- [ ] ", data.rich_text, block.children, depth);
    case "quote":
      return renderQuotedBlock(data.rich_text, block.children, depth);
    case "callout":
      return renderCalloutBlock(data, block.children, depth);
    case "toggle":
      return renderToggleBlock(data.rich_text, block.children, depth);
    case "divider":
      return indentBlock("---", depth);
    case "code":
      return indentBlock(renderCodeBlock(data.rich_text, data.language), depth);
    case "equation":
      return indentBlock(`$$\n${data.expression || ""}\n$$`, depth);
    case "image":
      return indentBlock(renderImageBlock(data), depth);
    case "video":
      return indentBlock(renderMediaLink("Video", data), depth);
    case "file":
      return indentBlock(renderMediaLink("File", data), depth);
    case "pdf":
      return indentBlock(renderMediaLink("PDF", data), depth);
    case "bookmark":
      return indentBlock(renderLinkLikeBlock(data.url, plainText(data.caption) || data.url), depth);
    case "embed":
      return indentBlock(renderLinkLikeBlock(data.url, plainText(data.caption) || "Embed"), depth);
    case "link_preview":
      return indentBlock(renderLinkLikeBlock(data.url, data.url), depth);
    case "table":
      return indentBlock(renderTableBlock(block), depth);
    case "column_list":
    case "column":
    case "synced_block":
      return renderBlocks(block.children || [], depth);
    case "child_page":
      return indentBlock(`## ${escapeMarkdownText(data.title || "Untitled page")}`, depth);
    case "table_of_contents":
    case "breadcrumb":
      return "";
    default:
      return withTrailingChildren(
        indentBlock(renderFallbackBlock(block.type, data.rich_text || data.caption || []), depth),
        block.children,
        depth,
      );
  }
}

function renderListItem(prefix, richText, children, depth) {
  const content = renderRichText(richText).trim();
  const line = indentBlock(`${prefix}${content}`.trimEnd(), depth);
  const nested = renderBlocks(children || [], depth + 1).trim();

  return nested ? `${line}\n${nested}` : line;
}

function renderQuotedBlock(richText, children, depth) {
  const parts = [renderRichText(richText), renderBlocks(children || [], 0)].filter(Boolean).join("\n\n");

  return indentBlock(prefixLines(parts, "> "), depth);
}

function renderCalloutBlock(data, children, depth) {
  const emoji =
    data.icon && data.icon.type === "emoji" && data.icon.emoji ? `${data.icon.emoji} ` : "";
  const content = `${emoji}${renderRichText(data.rich_text)}`.trim();
  const nested = renderBlocks(children || [], 0);
  const body = [content, nested].filter(Boolean).join("\n\n");

  return indentBlock(prefixLines(body, "> "), depth);
}

function renderToggleBlock(richText, children, depth) {
  const summary = renderRichText(richText).trim() || "Details";
  const nested = renderBlocks(children || [], 0).trim();
  const body = nested ? `\n\n${nested}\n` : "\n";

  return indentBlock(`<details>\n<summary>${summary}</summary>${body}\n</details>`, depth);
}

function renderCodeBlock(richText, language) {
  const code = plainText(richText);
  const fence = makeFence(code);
  const normalizedLanguage =
    language && language !== "plain text" ? language.replace(/\s+/g, "-").toLowerCase() : "";

  return `${fence}${normalizedLanguage}\n${code}\n${fence}`;
}

function renderImageBlock(data) {
  const url = getFileUrl(data);

  if (!url) {
    return "";
  }

  const caption = plainText(data.caption);
  const alt = escapeMarkdownText(caption || "image");
  const image = `![${alt}](${url})`;

  return caption ? `${image}\n\n*${escapeMarkdownText(caption)}*` : image;
}

function renderMediaLink(defaultLabel, data) {
  const url = getFileUrl(data);

  if (!url) {
    return "";
  }

  const label = plainText(data.caption) || defaultLabel;
  return renderLinkLikeBlock(url, label);
}

function renderLinkLikeBlock(url, label) {
  if (!url) {
    return "";
  }

  return `[${escapeMarkdownText(label || url)}](${url})`;
}

function renderTableBlock(block) {
  const rows = (block.children || []).filter((child) => child.type === "table_row");

  if (!rows.length) {
    return "";
  }

  const hasColumnHeader = Boolean(block.table && block.table.has_column_header);
  const headerRows = hasColumnHeader ? rows.slice(0, 1) : [];
  const bodyRows = hasColumnHeader ? rows.slice(1) : rows;
  const parts = ["<table>"];

  if (headerRows.length) {
    parts.push("  <thead>");
    parts.push(renderTableRows(headerRows, "th"));
    parts.push("  </thead>");
  }

  parts.push("  <tbody>");
  parts.push(renderTableRows(bodyRows, "td"));
  parts.push("  </tbody>");
  parts.push("</table>");

  return parts.filter(Boolean).join("\n");
}

function renderTableRows(rows, cellTag) {
  return rows
    .map((row) => {
      const cells = (row.table_row && row.table_row.cells) || [];
      const renderedCells = cells
        .map((cell) => `      <${cellTag}>${escapeHtml(plainText(cell)).replace(/\n/g, "<br />")}</${cellTag}>`)
        .join("\n");

      return ["    <tr>", renderedCells, "    </tr>"].join("\n");
    })
    .join("\n");
}

function renderFallbackBlock(type, richText) {
  const text = plainText(richText).trim();

  if (!text) {
    return "";
  }

  return `<!-- Unsupported Notion block: ${type} -->\n${escapeMarkdownText(text)}`;
}

function renderRichText(richText) {
  return (richText || []).map(renderRichTextItem).join("");
}

function renderRichTextItem(item) {
  if (!item) {
    return "";
  }

  const annotations = item.annotations || {};
  const isEquation = item.type === "equation";
  const rawText = isEquation ? `$${item.equation.expression || ""}$` : item.plain_text || "";
  let text;

  if (annotations.code) {
    text = wrapInlineCode(rawText);
  } else if (isEquation) {
    text = rawText;
  } else {
    text = escapeMarkdownText(rawText);
  }

  if (!annotations.code) {
    if (annotations.bold) {
      text = `**${text}**`;
    }
    if (annotations.italic) {
      text = `*${text}*`;
    }
    if (annotations.strikethrough) {
      text = `~~${text}~~`;
    }
    if (annotations.underline) {
      text = `<u>${text}</u>`;
    }
  }

  if (item.href) {
    text = `[${text}](${item.href})`;
  }

  return text;
}

function markdownToNotionBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeStart = line.match(/^```([A-Za-z0-9_+-]+)?\s*$/);
    if (codeStart) {
      const language = normalizeCodeLanguage(codeStart[1]);
      const codeLines = [];
      index += 1;

      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && /^```/.test(lines[index])) {
        index += 1;
      }

      blocks.push({
        object: "block",
        type: "code",
        code: {
          language,
          rich_text: richTextFromPlainText(codeLines.join("\n")),
        },
      });
      continue;
    }

    if (/^---\s*$/.test(line.trim())) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      index += 1;
      continue;
    }

    if (/^###\s+/.test(line)) {
      blocks.push(makeTextBlock("heading_3", line.replace(/^###\s+/, "")));
      index += 1;
      continue;
    }

    if (/^##\s+/.test(line)) {
      blocks.push(makeTextBlock("heading_2", line.replace(/^##\s+/, "")));
      index += 1;
      continue;
    }

    if (/^#\s+/.test(line)) {
      blocks.push(makeTextBlock("heading_1", line.replace(/^#\s+/, "")));
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted = [];

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(makeTextBlock("quote", quoted.join("\n")));
      continue;
    }

    if (/^-\s+/.test(line)) {
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        blocks.push(makeTextBlock("bulleted_list_item", lines[index].replace(/^-\s+/, "")));
        index += 1;
      }
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        blocks.push(makeTextBlock("numbered_list_item", lines[index].replace(/^\d+\.\s+/, "")));
        index += 1;
      }
      continue;
    }

    const paragraph = [];

    while (index < lines.length && shouldStayInParagraph(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }

    blocks.push(makeTextBlock("paragraph", paragraph.join("\n")));
  }

  return blocks;
}

function extractTitleAndBody(markdown, fallbackTitle = "Untitled") {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");

  if (lines.length && /^#\s+/.test(lines[0])) {
    const title = lines[0].replace(/^#\s+/, "").trim() || fallbackTitle;
    const body = lines.slice(1).join("\n").replace(/^\s+/, "");

    return { title, body };
  }

  return { title: fallbackTitle, body: String(markdown || "") };
}

function shouldStayInParagraph(line) {
  if (!line.trim()) {
    return false;
  }

  return !/^(#{1,3}\s+|>\s?|-\s+|\d+\.\s+|```|---\s*$)/.test(line);
}

function makeTextBlock(type, text) {
  const plain = stripInlineMarkdown(text);

  switch (type) {
    case "heading_1":
      return { object: "block", type, heading_1: { rich_text: richTextFromPlainText(plain) } };
    case "heading_2":
      return { object: "block", type, heading_2: { rich_text: richTextFromPlainText(plain) } };
    case "heading_3":
      return { object: "block", type, heading_3: { rich_text: richTextFromPlainText(plain) } };
    case "quote":
      return { object: "block", type, quote: { rich_text: richTextFromPlainText(plain) } };
    case "bulleted_list_item":
      return { object: "block", type, bulleted_list_item: { rich_text: richTextFromPlainText(plain) } };
    case "numbered_list_item":
      return { object: "block", type, numbered_list_item: { rich_text: richTextFromPlainText(plain) } };
    default:
      return { object: "block", type: "paragraph", paragraph: { rich_text: richTextFromPlainText(plain) } };
  }
}

function normalizeCodeLanguage(language) {
  const normalized = String(language || "").trim().toLowerCase();
  return normalized || "plain text";
}

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<u>(.*?)<\/u>/g, "$1")
    .trim();
}

function plainText(richText) {
  return (richText || []).map((item) => item.plain_text || "").join("");
}

function getFileUrl(data) {
  if (!data || !data.type) {
    return "";
  }

  if (data.type === "external" && data.external) {
    return data.external.url || "";
  }

  if (data.type === "file" && data.file) {
    return data.file.url || "";
  }

  return "";
}

function prefixLines(value, prefix) {
  return String(value || "")
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join("\n");
}

function indentBlock(value, depth) {
  if (!value) {
    return "";
  }

  const indent = " ".repeat(depth * 4);

  return String(value)
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : ""))
    .join("\n");
}

function withTrailingChildren(rendered, children, depth) {
  const nested = renderBlocks(children || [], depth + 1).trim();

  if (!rendered) {
    return nested;
  }

  return nested ? `${rendered}\n\n${nested}` : rendered;
}

function wrapInlineCode(value) {
  const backticks = (String(value).match(/`+/g) || []).map((token) => token.length);
  const fence = "`".repeat(Math.max(1, ...backticks) + 1);

  return `${fence}${value}${fence}`;
}

function makeFence(value) {
  const fences = (String(value).match(/`{3,}/g) || []).map((token) => token.length);
  return "`".repeat(Math.max(3, ...fences) + 1);
}

function escapeMarkdownText(value) {
  return String(value || "").replace(/([\\`*_[\]<>])/g, "\\$1");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

module.exports = {
  extractTitleAndBody,
  markdownToNotionBlocks,
  renderDocument,
};
