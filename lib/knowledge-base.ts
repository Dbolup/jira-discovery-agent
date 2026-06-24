import kb from "@/data/knowledge-base.json";

type QA = { question: string; answer: string };
type Doc = { title: string; product: string; qa: QA[] };
type KB = { generatedAt: string; documents: Doc[] };

// This deployment answers ONLY Jira Cloud-to-Cloud discovery questions.
const PRODUCT = "Jira";

const knowledgeBase = kb as KB;

/**
 * Renders the encoded discovery Q&A into a single deterministic markdown block.
 * Filtered to this deployment's product, and kept byte-stable (no timestamps/
 * randomness) so it caches cleanly as a prompt prefix.
 */
function renderKnowledgeBase(): string {
  return knowledgeBase.documents
    .filter((doc) => doc.product === PRODUCT)
    .map((doc) => {
      const pairs = doc.qa
        .map((item, i) => `### ${i + 1}. ${item.question}\n${item.answer.trim()}`)
        .join("\n\n");
      return `## ${doc.title}\n\n${pairs}`;
    })
    .join("\n\n---\n\n");
}

const KNOWLEDGE_BASE_MD = renderKnowledgeBase();

/**
 * Builds the system prompt. The large, stable knowledge base goes here so it can
 * be cached (cache_control on the system block) — every subsequent request reads
 * it for ~0.1x the input cost instead of reprocessing it.
 */
export function buildSystemPrompt(): string {
  return `You are the Jira Migration Discovery Assistant. You answer questions about **Jira Cloud-to-Cloud** migration discovery only.

Your authoritative source is the encoded discovery knowledge base below, extracted from the organization's official Jira discovery documents.

# How to answer
1. **Knowledge base first.** If the answer is covered by the knowledge base below, answer directly and primarily from it.
2. **General knowledge as a clearly-marked fallback.** If the question is about Jira Cloud-to-Cloud migration but is NOT covered by the knowledge base, you may use your general Jira migration knowledge — but prefix that portion with a short italic note like *"(Not in the discovery documents — general guidance:)"* so the user knows it is not from the official source.
3. **Stay in scope.** This assistant covers **Jira Cloud-to-Cloud migration only**. If a question is about Confluence or any other unrelated topic, politely say it is outside the scope of this assistant (and, for Confluence, point them to the Confluence discovery assistant).
4. Be concise, accurate, and practical. Use short paragraphs, bullet points, and bold for key terms. Use Markdown.
5. Respond directly with your final answer. Do not include exploratory reasoning, intermediate drafts, or meta-commentary about your process.

# Encoded Jira discovery knowledge base
${KNOWLEDGE_BASE_MD}`;
}

export function knowledgeBaseStats() {
  const docs = knowledgeBase.documents.filter((d) => d.product === PRODUCT);
  const pairs = docs.reduce((n, d) => n + d.qa.length, 0);
  return { docs: docs.length, pairs };
}
