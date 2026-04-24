function parseSourceInput(rawValue) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return {
      sourcePageId: "",
      sourcePath: "",
      sourceInputKind: "default",
      sourceInputValue: "",
    };
  }

  const pageId = extractPageId(value);

  if (pageId) {
    return {
      sourcePageId: pageId,
      sourcePath: "",
      sourceInputKind: /notion\.so/i.test(value) ? "url" : "page_id",
      sourceInputValue: value,
    };
  }

  return {
    sourcePageId: "",
    sourcePath: value,
    sourceInputKind: "path",
    sourceInputValue: value,
  };
}

function extractPageId(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  const hyphenated = trimmed.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  if (hyphenated) {
    return hyphenated[0].toLowerCase();
  }

  const compact = trimmed.match(/^[0-9a-f]{32}$/i);
  if (compact) {
    return formatCompactPageId(compact[0]);
  }

  if (/notion\.so/i.test(trimmed)) {
    const hyphenatedUrl = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (hyphenatedUrl) {
      return hyphenatedUrl[1].toLowerCase();
    }

    const compactUrl = trimmed.match(/([0-9a-f]{32})(?:\?|#|$)/i);
    if (compactUrl) {
      return formatCompactPageId(compactUrl[1]);
    }
  }

  return "";
}

function formatCompactPageId(value) {
  const raw = String(value || "").toLowerCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

module.exports = {
  extractPageId,
  parseSourceInput,
};
