"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ChatMessage = { id: string; body: string; outbound: boolean; time: string };

export function ChatThread({
  contactName, messages, placeholder, sendLabel,
}: {
  contactName: string;
  messages: ChatMessage[];
  placeholder: string;
  sendLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const initials = contactName.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
        <Avatar className="h-9 w-9"><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <span className="font-medium">{contactName}</span>
      </header>

      <div className="flex-1 space-y-2 overflow-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.outbound ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[75%] rounded-lg px-3 py-2 text-sm shadow",
                m.outbound ? "bg-bubble-out text-foreground" : "bg-bubble-in text-foreground"
              )}
            >
              <p>{m.body}</p>
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">{m.time}</span>
            </div>
          </div>
        ))}
      </div>

      <form
        className="flex items-center gap-2 border-t bg-background p-3"
        onSubmit={(e) => { e.preventDefault(); setDraft(""); }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="flex-1" />
        <Button type="submit" size="icon" aria-label={sendLabel}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
