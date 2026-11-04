"use client";
import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import ReplyBox from "./reply-box";

type Msg = { id: string; direction: "inbound" | "outbound"; body: string | null; sentAt: string; status: string };

export default function ChatPane({
  workspaceSlug, conversationId, contactLabel, initialMessages,
}: {
  workspaceSlug: string; conversationId: string; contactLabel: string; initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = getSocket();
    s.emit("conv:join", conversationId);
    function onMsg(m: any) {
      if (!m?.evolutionMessageId) return;
      setMessages((curr) => {
        // Dedup by evolutionMessageId if we've recorded it
        if (curr.some((x) => (x as any).evolutionMessageId === m.evolutionMessageId)) return curr;
        // Dedup outbound echoes: if this is an outbound message and we have an unmatched outbound with same body in the last 60s, attach the evo id instead of appending
        if (m.direction === "outbound") {
          const sentAtMs = new Date(m.sentAt).getTime();
          const idx = curr.findIndex((x) =>
            x.direction === "outbound" &&
            !(x as any).evolutionMessageId &&
            (x.body ?? "") === (m.body ?? "") &&
            Math.abs(new Date(x.sentAt).getTime() - sentAtMs) < 60000
          );
          if (idx !== -1) {
            const next = [...curr];
            next[idx] = { ...next[idx]!, status: "delivered", evolutionMessageId: m.evolutionMessageId } as any;
            return next;
          }
        }
        return [...curr, { id: m.evolutionMessageId, direction: m.direction, body: m.body, sentAt: m.sentAt, status: "delivered" }];
      });
    }
    s.on("message", onMsg);
    return () => { s.emit("conv:leave", conversationId); s.off("message", onMsg); };
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  function onLocalAppend(m: Msg) {
    setMessages((curr) => [...curr, m]);
  }

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b p-3 font-semibold">{contactLabel}</header>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[70%] px-3 py-2 rounded ${m.direction === "outbound" ? "bg-bubble-out ml-auto" : "bg-bubble-in border"}`}>
            <div className="text-sm whitespace-pre-wrap">{m.body ?? ""}</div>
            <div className="text-[10px] opacity-60 mt-1">{new Date(m.sentAt).toLocaleTimeString("en-GB")} · {m.status}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ReplyBox workspaceSlug={workspaceSlug} conversationId={conversationId} onSent={onLocalAppend} />
    </main>
  );
}
