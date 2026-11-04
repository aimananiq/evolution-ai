import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { writeAsset, detectKind } from "@/lib/media-storage";
import { checkStorage } from "@evo/limits";

const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

const ALLOWED_MIMETYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/3gpp",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    // ?folderId=<id> filters to a folder; ?folderId=root shows only unfiled files; absent = all.
    const folderParam = new URL(req.url).searchParams.get("folderId");
    const where = folderParam === "root" ? { folderId: null } : folderParam ? { folderId: folderParam } : {};
    const assets = await db.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        filename: true,
        mimetype: true,
        sizeBytes: true,
        kind: true,
        folderId: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ assets });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    if (!ALLOWED_MIMETYPES.has(file.type)) {
      return NextResponse.json({ error: "MIMETYPE_NOT_ALLOWED" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
    }

    // Per-plan storage cap (featureFlags.storageCapMb; 0 = unlimited).
    const storage = await checkStorage(workspace.id, file.size);
    if (!storage.allowed) {
      return NextResponse.json(
        { error: "STORAGE_CAP_REACHED", usedBytes: storage.usedBytes, capBytes: storage.capBytes },
        { status: 402 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { storageKey, sizeBytes } = await writeAsset(
      workspace.id,
      file.name,
      bytes
    );

    const db = tenantClient(workspace.id);
    // Optional target folder — only honoured if it belongs to this workspace.
    const folderIdRaw = formData.get("folderId");
    let folderId: string | null = null;
    if (typeof folderIdRaw === "string" && folderIdRaw && folderIdRaw !== "root") {
      const folder = await db.mediaFolder.findUnique({ where: { id: folderIdRaw } });
      folderId = folder ? folder.id : null;
    }
    const asset = await db.mediaAsset.create({
      data: {
        filename: file.name,
        mimetype: file.type,
        sizeBytes,
        storageKey,
        kind: detectKind(file.type),
        uploadedById: userId,
        folderId,
      } as any,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
