"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PairView({
  workspaceSlug,
  instanceId,
}: {
  workspaceSlug: string;
  instanceId: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<string>("connecting");
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    async function pollQr() {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}/qr`);
      if (!alive) return;
      if (res.ok) {
        const { qr } = await res.json();
        setQr(qr?.base64 ?? null);
      }
    }
    async function pollState() {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}/state`);
      if (!alive) return;
      if (res.ok) {
        const { state } = await res.json();
        setState(state);
        if (state === "open") {
          router.refresh();
        }
      }
    }

    pollQr();
    pollState();
    const qrTimer = setInterval(pollQr, 25000);
    const stateTimer = setInterval(pollState, 3000);
    return () => {
      alive = false;
      clearInterval(qrTimer);
      clearInterval(stateTimer);
    };
  }, [workspaceSlug, instanceId, router]);

  return (
    <div className="space-y-3">
      {qr ? (
        // Evolution returns the QR as a data URL (data:image/png;base64,…)
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code" className="w-64 h-64 border rounded bg-card p-2" />
      ) : (
        <div className="w-64 h-64 border rounded flex items-center justify-center text-muted-foreground">…</div>
      )}
      <p className="text-sm">State: <code>{state}</code></p>
    </div>
  );
}
