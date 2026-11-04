"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildGuardrails } from "@/lib/assistant";

export function AdvancedSection({
  workspaceSlug,
  topicId,
  live,
  liveChatbotId,
  initialOnlyFromKnowledge,
  initialHandoff,
  initialHandoffMessage,
}: {
  workspaceSlug: string;
  topicId: string;
  live: boolean;
  liveChatbotId: string | null;
  initialOnlyFromKnowledge: boolean;
  initialHandoff: boolean;
  initialHandoffMessage: string;
}) {
  const router = useRouter();
  const [onlyFromKnowledge, setOnlyFromKnowledge] = useState(initialOnlyFromKnowledge);
  const [handoff, setHandoff] = useState(initialHandoff);
  const [handoffMessage, setHandoffMessage] = useState(initialHandoffMessage);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/workspaces/${workspaceSlug}/topics/${topicId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guardrails: buildGuardrails({ onlyFromKnowledge, handoff, handoffMessage }),
      }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <details className="rounded-lg border border-border bg-card px-6 py-4">
      <summary className="cursor-pointer text-lg font-semibold text-foreground">
        Advanced
      </summary>

      <div className="space-y-4 pt-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={onlyFromKnowledge}
            onChange={(e) => setOnlyFromKnowledge(e.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-foreground">
              Only answer using this knowledge (don&apos;t make things up)
            </span>
            <span className="block text-xs text-muted-foreground">
              The assistant will not guess — it replies with a fallback if it doesn&apos;t know.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={handoff}
            onChange={(e) => setHandoff(e.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-foreground">
              Hand over to a human when it can&apos;t help
            </span>
            <span className="block text-xs text-muted-foreground">
              Sends a message and flags the conversation for your team.
            </span>
          </span>
        </label>

        {handoff && (
          <div className="space-y-1.5 pl-7">
            <Label htmlFor="adv-handoff-msg">Message sent to the customer</Label>
            <Input
              id="adv-handoff-msg"
              value={handoffMessage}
              onChange={(e) => setHandoffMessage(e.target.value)}
            />
          </div>
        )}

        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>

        <div className="border-t border-border pt-4">
          {live && liveChatbotId ? (
            <Link
              href={`/${workspaceSlug}/automation/chatbot/${liveChatbotId}`}
              className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Manage quick replies →
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Turn on to add quick replies.</p>
          )}
        </div>
      </div>
    </details>
  );
}
