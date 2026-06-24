import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/knowledge-base";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Node runtime so we can keep an in-memory rate limiter and a long-lived stream.
export const runtime = "nodejs";
export const maxDuration = 60;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Built once per warm instance — stable bytes so the prompt cache stays valid.
const SYSTEM_PROMPT = buildSystemPrompt();

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 4096;
const MAX_HISTORY = 20; // cap turns sent back to keep requests bounded

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  // 1. Rate limit by IP.
  const ip = clientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit reached. Please wait a moment and try again.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      }
    );
  }

  // 2. Validate input.
  let body: { messages?: IncomingMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = (body.messages ?? [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY);

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(
      JSON.stringify({ error: "Expected a non-empty user message." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Stream the answer from Claude.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "disabled" }, // snappy chat; switch to {type:"adaptive"} for deeper reasoning
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // ~90% cheaper input on repeat requests
      },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        console.error("Stream error:", err);
        controller.enqueue(
          encoder.encode("\n\n_Sorry — something went wrong generating the response._")
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
