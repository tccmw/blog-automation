const https = require("https");

function getOpenAIConfig(env = process.env) {
  return {
    apiKey: env.OPENAI_API_KEY || "",
    model: env.OPENAI_MODEL || "gpt-5",
    maxOutputTokens: toPositiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS, 5000),
  };
}

function validateOpenAIConfig(config) {
  if (!config.apiKey) {
    throw new Error("Missing OPENAI_API_KEY for blog draft generation.");
  }
}

async function generateMarkdownDraft({ instructions, sourceMarkdown, sourceMeta, env = process.env }) {
  const config = getOpenAIConfig(env);
  validateOpenAIConfig(config);

  const metadataBlock = JSON.stringify(sourceMeta || {}, null, 2);
  const input = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "Rewrite the following Notion source note into a Tistory-ready Markdown blog post.",
            "Return only the final Markdown article.",
            "",
            "[Source Metadata]",
            metadataBlock,
            "",
            "[Source Markdown]",
            sourceMarkdown,
          ].join("\n"),
        },
      ],
    },
  ];

  const response = await openAIRequest(config, {
    method: "POST",
    resourcePath: "/v1/responses",
    body: {
      model: config.model,
      instructions,
      input,
      max_output_tokens: config.maxOutputTokens,
    },
  });

  const outputText = extractOutputText(response).trim();

  if (!outputText) {
    throw new Error("OpenAI returned an empty draft.");
  }

  return {
    markdown: ensureTrailingNewline(outputText),
    response,
  };
}

function extractOutputText(response) {
  if (response && typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const outputs = Array.isArray(response && response.output) ? response.output : [];
  const chunks = [];

  for (const item of outputs) {
    const contents = Array.isArray(item && item.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      } else if (content && typeof content === "object" && typeof content.output_text === "string") {
        chunks.push(content.output_text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function openAIRequest(config, { method, resourcePath, body }) {
  const requestBody = body ? JSON.stringify(body) : null;
  const url = new URL(`https://api.openai.com${resourcePath}`);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
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
            (json && json.error && json.error.message) ||
            (json && json.message) ||
            `OpenAI API request failed with status ${response.statusCode}.`;

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

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

module.exports = {
  generateMarkdownDraft,
  getOpenAIConfig,
  validateOpenAIConfig,
};
