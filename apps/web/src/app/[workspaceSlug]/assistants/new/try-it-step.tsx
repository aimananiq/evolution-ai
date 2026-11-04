"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildGuardrails } from "@/lib/assistant";

type Guardrails = {
  onlyFromKnowledge: boolean;
  handoff: boolean;
  handoffMessage: string;
};

type MessageRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  fellBack?: boolean;
  errorKind?: "AI_ERROR" | "NO_AI_CONFIG" | "UNKNOWN";
};

const SUGGESTED_QUESTIONS = [
  "What can you help me with?",
  "What are your opening hours?",
  "How do I contact support?",
];

export function TryItStep({
  workspaceSlug,
  topicId,
  guardrails,
  onBack,
  onNext,
}: {
  workspaceSlug: string;
  topicId: string;
  guardrails: Guardrails;
  onBack?: () => void;
  onNext?: () => void;
}) {
  const base = `/api/workspaces/${workspaceSlug}/topics/${topicId}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const guardrailsSaved = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist guardrails once before the first send
  async function ensureGuardrailsSaved() {
    if (guardrailsSaved.current) return;
    guardrailsSaved.current = true;
    await fetch(`${base}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardrails: buildGuardrails(guardrails) }),
    });
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setInput("");
    setSending(true);

    try {
      // Persist guardrails on the first send (kept inside try so a network
      // failure here still hits finally and never freezes the UI).
      await ensureGuardrailsSaved();

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);

      const res = await fetch(`${base}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.reply ?? "",
          fellBack: data.fellBack === true,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else if (data?.error === "AI_ERROR") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "The AI service had a problem — check your AI settings.",
            errorKind: "AI_ERROR",
          },
        ]);
      } else if (data?.error === "NO_AI_CONFIG") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Set up your AI connection in Settings → Integrations → AI first.",
            errorKind: "NO_AI_CONFIG",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Something went wrong. Please try again.",
            errorKind: "UNKNOWN",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Something went wrong. Please try again.",
          errorKind: "UNKNOWN",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Try it</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Test your assistant before going live. The safety settings you chose are active here.
        </p>
      </div>

      {/* Chat window */}
      <div className="rounded-lg border border-border bg-secondary/30 flex flex-col h-80 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center pt-8">
              Send a message to test your assistant.
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div className="flex flex-col gap-0.5 max-w-[80%]">
                <div
                  className="rounded-2xl px-3 py-2 text-sm text-foreground"
                  style={
                    msg.role === "user"
                      ? { backgroundColor: "hsl(var(--bubble-out))" }
                      : { backgroundColor: "hsl(var(--bubble-in))" }
                  }
                >
                  {msg.text}
                </div>
                {msg.fellBack && (
                  <p className="text-xs text-muted-foreground px-1">Handed off to team</p>
                )}
                {msg.errorKind && (
                  <p className="text-xs text-destructive px-1">
                    {msg.errorKind === "AI_ERROR"
                      ? "AI service error"
                      : msg.errorKind === "NO_AI_CONFIG"
                      ? "No AI configured"
                      : "Error"}
                  </p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input row */}
        <div className="border-t border-border p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            disabled={sending}
            className="flex-1"
          />
          <Button
            type="button"
            disabled={!input.trim() || sending}
            onClick={() => sendMessage(input)}
          >
            {sending ? "…" : "Send"}
          </Button>
        </div>
      </div>

      {/* Suggested questions */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Try asking:</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={sending}
              onClick={() => sendMessage(q)}
              className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      {(onBack || onNext) && (
        <div className="flex items-center justify-between pt-2">
          {onBack ? (
            <Button type="button" variant="outline" onClick={onBack} disabled={sending}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {onNext ? (
            <Button type="button" onClick={onNext} disabled={sending}>
              Next
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
