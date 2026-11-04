import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { chunkText } from "@evo/kb";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

// Buffer (for mammoth) is needed, so force the Node.js runtime.
export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);

    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) {
      return NextResponse.json({ error: "TOPIC_NOT_FOUND" }, { status: 404 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    if (!ALLOWED_MIMETYPES.has(file.type)) {
      return NextResponse.json({ error: "MIMETYPE_NOT_ALLOWED" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    let text = "";
    try {
      if (file.type === "application/pdf") {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(bytes);
        const res = await extractText(pdf, { mergePages: true });
        text = Array.isArray(res.text) ? res.text.join("\n") : res.text;
      } else {
        const mammothMod = await import("mammoth");
        const mammoth = mammothMod.default ?? mammothMod;
        const out = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        text = out.value;
      }
    } catch {
      return NextResponse.json({ error: "EXTRACT_FAILED" }, { status: 400 });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return NextResponse.json({ error: "EMPTY_DOCUMENT" }, { status: 400 });
    }

    await db.knowledgeSnippet.createMany({
      data: chunks.map((c, i) => ({
        topicId: id,
        title: `${file.name} #${i + 1}`,
        content: c,
        sourceType: file.type === "application/pdf" ? "pdf" : "word",
        sourceLabel: file.name,
      })) as any,
    });

    return NextResponse.json({ inserted: chunks.length }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
