/**
 * PDF ingestion — turns your discovery PDFs into data/knowledge-base.json.
 *
 * Usage:
 *   1. Put your PDFs in ./pdfs  (e.g. ./pdfs/jira-discovery.pdf, ./pdfs/confluence-discovery.pdf)
 *   2. Make sure ANTHROPIC_API_KEY is set (the script uses Claude to structure the text).
 *   3. Run:  npm run ingest
 *      - add  --raw   to skip Claude and just store cleaned page text (no Q&A structuring)
 *
 * Then redeploy (or restart `npm run dev`) so the app picks up the new knowledge base.
 *
 * This is the JIRA-only deployment: every ingested PDF is tagged "Jira".
 * (Confluence discovery PDFs belong in the separate confluence-discovery-agent project.)
 */

import { createRequire } from "module";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, basename, extname } from "path";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const RAW = process.argv.includes("--raw");
const PDF_DIR = join(process.cwd(), "pdfs");
const OUT = join(process.cwd(), "data", "knowledge-base.json");
const MODEL = "claude-opus-4-8";

// Jira-only deployment: every PDF in this project is tagged Jira.
const PRODUCT = "Jira";
function productFromName(_name) {
  return PRODUCT;
}

async function structureWithClaude(text, product) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      qa: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
        },
      },
    },
    required: ["qa"],
  };

  // Stream because output can be large; get the final message at the end.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema } },
    system:
      `You convert raw text from an Atlassian ${product} Cloud-to-Cloud migration ` +
      `discovery document into clean question/answer pairs. Preserve the original ` +
      `wording and meaning. If the document is a questionnaire with answers, pair ` +
      `each question with its answer. Do not invent content that is not in the text.`,
    messages: [
      {
        role: "user",
        content: `Extract every discovery question and its answer from this document:\n\n${text}`,
      },
    ],
  });

  const msg = await stream.finalMessage();
  const block = msg.content.find((b) => b.type === "text");
  const parsed = JSON.parse(block.text);
  return parsed.qa ?? [];
}

async function main() {
  if (!existsSync(PDF_DIR)) {
    mkdirSync(PDF_DIR, { recursive: true });
    console.log(`Created ${PDF_DIR}. Put your PDF files there and re-run.`);
    return;
  }

  const files = readdirSync(PDF_DIR).filter((f) => extname(f).toLowerCase() === ".pdf");
  if (files.length === 0) {
    console.log(`No PDFs found in ${PDF_DIR}. Add your discovery PDFs and re-run.`);
    return;
  }

  if (!RAW && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Set it, or run with --raw to skip Claude structuring."
    );
    process.exit(1);
  }

  const documents = [];
  for (const file of files) {
    const product = productFromName(file);
    const title = `${basename(file, ".pdf")} (${product})`;
    process.stdout.write(`Reading ${file} … `);

    const data = await pdf(readFileSync(join(PDF_DIR, file)));
    const text = data.text.replace(/\n{3,}/g, "\n\n").trim();

    let qa;
    if (RAW) {
      // One pseudo-pair holding the whole document — still works with full-context.
      qa = [{ question: `Full content of ${title}`, answer: text }];
    } else {
      qa = await structureWithClaude(text, product);
    }

    documents.push({ title, product, qa });
    console.log(`${qa.length} Q&A pair(s).`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    documents,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const total = documents.reduce((n, d) => n + d.qa.length, 0);
  console.log(`\nWrote ${OUT} — ${documents.length} document(s), ${total} Q&A pair(s).`);
  console.log("Redeploy (or restart the dev server) to load the new knowledge base.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
