"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  workspaceSlug: string;
  instanceId: string;
}

type Result =
  | { ok: true; controlLabel: string }
  | { error: "NEEDS_TWO_NUMBERS" }
  | { status: "error"; message: string };

export function TestDeliveryButton({ workspaceSlug, instanceId }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/instances/${instanceId}/test-delivery`,
        { method: "POST" },
      );
      const json = (await res.json()) as Result;
      setResult(json);
    } catch {
      setResult({ status: "error", message: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function resultMessage(): string {
    if (!result) return "";
    if ("ok" in result && result.ok) {
      return `Probe sent to ${result.controlLabel} — check delivery status in a few minutes`;
    }
    if ("error" in result && result.error === "NEEDS_TWO_NUMBERS") {
      return "Add a second connected number to run delivery checks";
    }
    if ("message" in result) {
      return result.message;
    }
    return "Unknown error";
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        {busy ? "Testing…" : "Test delivery now"}
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">{resultMessage()}</p>
      )}
    </div>
  );
}
