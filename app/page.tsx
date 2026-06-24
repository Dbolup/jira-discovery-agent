"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What is a Jira Cloud-to-Cloud migration?",
  "Which Jira data can be migrated between Cloud sites?",
  "How are users and groups handled during migration?",
  "What discovery questions should I ask before migrating?",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setBanner(null);

    const nextMessages: Message[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextMessages);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setStreaming(true);

    // Add an empty assistant message we'll stream into.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          res.status === 429
            ? "You're sending messages too quickly. Please wait a moment and try again."
            : data.error || "Something went wrong. Please try again.";
        setBanner(msg);
        setMessages((m) => m.slice(0, -1)); // drop the empty assistant bubble
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch {
      setBanner("Network error. Please check your connection and try again.");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M11.6 12.5L6 6.9a.6.6 0 00-1 .4V18a.6.6 0 001 .4l3-3 2.6-2.6a.6.6 0 000-.8z"
              fill="#fff"
            />
            <path
              d="M12.4 11.5L18 17.1a.6.6 0 001-.4V6a.6.6 0 00-1-.4l-3 3-2.6 2.6a.6.6 0 000 .8z"
              fill="#fff"
              opacity="0.7"
            />
          </svg>
        </span>
        <div>
          <h1>Jira Migration Discovery Assistant</h1>
          <p>Jira Cloud-to-Cloud · powered by Claude</p>
        </div>
      </header>

      {banner && <div className="banner">{banner}</div>}

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="empty">
            <h2>How can I help with your Jira migration?</h2>
            <p>
              Ask me about Jira Cloud-to-Cloud migration discovery. Answers come
              from the encoded discovery documents first.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            return (
              <div key={i} className={`row ${m.role}`}>
                <span className={`avatar ${m.role === "user" ? "user" : "bot"}`}>
                  {m.role === "user" ? "You" : "AI"}
                </span>
                <div className="bubble">
                  {m.role === "assistant" ? (
                    <>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content || "…"}
                      </ReactMarkdown>
                      {streaming && isLast && (
                        <span className="cursor" aria-hidden />
                      )}
                    </>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="composer">
        <textarea
          ref={taRef}
          value={input}
          rows={1}
          placeholder="Ask about Jira Cloud-to-Cloud migration…"
          onChange={(e) => {
            setInput(e.target.value);
            autosize();
          }}
          onKeyDown={onKeyDown}
          disabled={streaming}
        />
        <button
          className="send"
          onClick={() => send(input)}
          disabled={streaming || !input.trim()}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a1 1 0 00-1.4.92V9.5a1 1 0 00.8.98l9.7 1.52-9.7 1.52a1 1 0 00-.8.98v4.98a1 1 0 001.4.92z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      <div className="footnote">
        AI-generated answers may contain mistakes. Verify critical migration
        decisions against official Atlassian documentation.
      </div>
    </div>
  );
}
