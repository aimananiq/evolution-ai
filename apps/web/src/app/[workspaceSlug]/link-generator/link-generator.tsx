"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { buildWaLink } from "@evo/shared";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Instance {
  id: string;
  label: string;
  phoneNumber: string | null;
}

export default function LinkGenerator({ instances }: { instances: Instance[] }) {
  const t = useTranslations("linkGenerator");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [selectedInstance, setSelectedInstance] = useState(instances[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Prefill phone when instance changes
  useEffect(() => {
    const inst = instances.find((i) => i.id === selectedInstance);
    if (inst?.phoneNumber) {
      setPhone(inst.phoneNumber);
    }
  }, [selectedInstance, instances]);

  // Render QR whenever link changes
  useEffect(() => {
    if (!link || !canvasRef.current) return;
    import("qrcode").then((QRCode) => {
      QRCode.toCanvas(canvasRef.current!, link, { width: 256 }, (err) => {
        if (err) console.error("QR error", err);
      });
    });
  }, [link]);

  function generate() {
    setError(null);
    setLink(null);
    setCopied(false);
    try {
      const url = buildWaLink(phone, message);
      setLink(url);
    } catch {
      setError(t("errorPhone"));
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4 max-w-lg">
      {instances.length > 0 && (
        <label className="block">
          <span className="text-sm font-medium">{t("prefillFromInstance")}</span>
          <select
            className="w-full border rounded p-2 mt-1"
            value={selectedInstance}
            onChange={(e) => setSelectedInstance(e.target.value)}
          >
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.label}{i.phoneNumber ? ` (${i.phoneNumber})` : ""}</option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium">{t("phone")}</span>
        <input
          type="tel"
          className="w-full border rounded p-2 mt-1"
          placeholder="+60 12-345 6789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">{t("message")}</span>
        <WhatsAppRichEditor
          value={message}
          onChange={(v) => setMessage(v)}
          placeholder={t("messagePlaceholder")}
          minRows={3}
        />
      </label>

      <Button onClick={generate}>{t("generate")}</Button>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {link && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary underline text-sm break-all flex-1">
              {link}
            </a>
            <Button onClick={copy} variant="outline" size="sm" className="shrink-0">
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <canvas ref={canvasRef} className="block rounded" />
        </Card>
      )}
    </div>
  );
}
