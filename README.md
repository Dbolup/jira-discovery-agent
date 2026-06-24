# Jira Migration Discovery Assistant

A public RAG (retrieval-augmented generation) chat agent that answers **Jira Cloud-to-Cloud** migration discovery questions, powered by **Claude (Opus 4.8)**.

> This is the **Jira-only** deployment. The companion **Confluence-only** deployment lives in `../confluence-discovery-agent` and uses the same code with a Confluence knowledge base and the same API key.

- **Frontend + backend in one app** — Next.js (App Router), Atlassian-styled chat UI, streaming responses.
- **Knowledge from your PDFs** — an ingestion script converts your discovery PDFs into a knowledge base the agent answers from.
- **No vector database needed** — the curated Q&A set is loaded into the model's context and **prompt-cached** (~90% cheaper on repeat requests). Only your Anthropic API key is required.
- **Public-safe** — per-IP rate limiting to protect your API key from abuse.
- **Grounding** — answers come from your PDFs first; anything outside them is clearly labelled as general guidance.

---

## How the "RAG" works (why there's no vector DB)

For a *bounded, curated* Q&A set (a few PDFs of discovery questions), you don't need embeddings + a vector store. Instead, the full knowledge base is placed in the model's **system prompt** and marked with `cache_control`, so:

- The model "retrieves" the relevant Q&A internally with full accuracy — no chunk-matching misses.
- After the first request, the knowledge base is served from cache at ~0.1× input cost.
- The only credential you need is `ANTHROPIC_API_KEY`.

If your content ever grows into hundreds of pages, see **Scaling up** at the bottom.

---

## 1. Run locally

```bash
cd rag-discovery-agent
npm install
cp .env.example .env.local      # then paste your Anthropic key into .env.local
npm run dev                     # open http://localhost:3000
```

It works immediately on a small seed knowledge base so you can see it before adding your PDFs.

---

## 2. Feed the agent your PDFs  ← the important part

1. Drop your discovery PDFs into the **`pdfs/`** folder, e.g.:
   ```
   pdfs/jira-cloud-discovery.pdf
   pdfs/confluence-cloud-discovery.pdf
   ```
   > Filenames containing "conf" are tagged **Confluence**; everything else is tagged **Jira**. Rename to control this.

2. Make sure your key is set (`ANTHROPIC_API_KEY` in `.env.local`, or exported in your shell), then run:
   ```bash
   npm run ingest
   ```
   This extracts the text from each PDF and uses Claude to structure it into clean question/answer pairs, writing **`data/knowledge-base.json`**.

   - Add `--raw` (`npm run ingest -- --raw`) to skip Claude and just store the cleaned page text — useful if your PDFs aren't a clean Q&A format. Full-context retrieval still works with raw text.

3. Restart the dev server (or redeploy). The agent now answers from your documents.

> **Tip:** You can also hand-edit `data/knowledge-base.json` directly — it's just `{ documents: [{ title, product, qa: [{ question, answer }] }] }`. The ingestion script is only a convenience.

`pdfs/` is git-ignored, so your raw source documents are never committed or deployed — only the generated `knowledge-base.json` ships.

---

## 3. Push to GitHub

```bash
cd rag-discovery-agent
git init
git add .
git commit -m "RAG discovery agent: Jira & Confluence Cloud-to-Cloud"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env.local` and `pdfs/` are git-ignored — your key and raw PDFs stay private.

---

## 4. Deploy to Vercel (public)

1. Go to [vercel.com/new](https://vercel.com/new) and **import** your GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Root directory: `rag-discovery-agent` if your repo contains other folders.
3. Add an **Environment Variable**:
   - `ANTHROPIC_API_KEY` = your key
   - *(optional)* `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`
4. **Deploy.** Vercel gives you a public URL like `https://your-app.vercel.app` — that's your live, public agent.

Every `git push` to `main` redeploys automatically. After re-ingesting new PDFs, commit the updated `data/knowledge-base.json` and push.

---

## Configuration

| Setting | Where | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | env var | — (required) |
| `RATE_LIMIT_MAX` | env var | 20 requests |
| `RATE_LIMIT_WINDOW_MS` | env var | 600000 (10 min) |
| Model | `app/api/chat/route.ts` | `claude-opus-4-8` |
| Reasoning depth | `app/api/chat/route.ts` | `thinking: { type: "disabled" }` — set `{ type: "adaptive" }` for harder questions |

---

## Security & cost notes

- The rate limiter is **in-memory per serverless instance** — good against casual bot abuse, but not a strict global cap. For production-grade limits, swap `lib/rate-limit.ts` for **Vercel KV** or **Upstash Redis** (same function signature).
- Prompt caching keeps per-request cost low, but a public endpoint backed by your paid key still costs money per message. Watch usage in the Anthropic Console and consider lowering `RATE_LIMIT_MAX`, or switching the access model to a password gate, if abuse appears.
- Never commit `.env.local`. If a key leaks, rotate it in the Anthropic Console.

---

## Scaling up (if content grows to hundreds of pages)

Full-context + caching is ideal up to a large knowledge base. If you outgrow it:

1. Generate embeddings with **Voyage AI** (Anthropic's recommended embeddings partner).
2. Store vectors in **Vercel Postgres (pgvector)** or **Pinecone**.
3. In `app/api/chat/route.ts`, embed the user's question, retrieve the top-K matching Q&A, and inject only those into the system prompt.

The frontend and streaming logic stay exactly the same.

---

## Project structure

```
rag-discovery-agent/
├── app/
│   ├── api/chat/route.ts   # streaming Claude endpoint + prompt caching + rate limit
│   ├── page.tsx            # Atlassian-styled chat UI
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── knowledge-base.ts   # builds the cached system prompt from the KB
│   └── rate-limit.ts       # per-IP sliding-window limiter
├── data/
│   └── knowledge-base.json # generated from your PDFs (seeded to run out of the box)
├── scripts/
│   └── ingest-pdfs.mjs     # PDF -> knowledge-base.json
└── pdfs/                   # your source PDFs (git-ignored)
```
