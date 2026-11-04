import { NextResponse } from "next/server";
import { z } from "zod";
import Papa from "papaparse";
import { tenantClient } from "@evo/db";
import { EvolutionClient, ContactApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  instanceId: z.string(),
  csv: z.string().min(1).max(2_000_000),
  validate: z.boolean().optional().default(true),
  listName: z.string().max(120).optional(),
});

interface Row {
  phone: string;
  name?: string;
  customFields?: Record<string, string>;
}

function normalisePhone(raw: string): string | null {
  let d = raw.replace(/[^0-9]/g, "");
  if (!d) return null;
  // National → E.164 using Malaysia's country code (the platform's primary market).
  // A leading "0" is the local trunk prefix ("0165141884" → "60165141884"); a bare
  // 9–10 digit mobile starting with "1" ("165141884" → "60165141884") also gets 60.
  // Numbers already in international form (60…, or another country's code) are left alone.
  if (d.startsWith("0")) d = "60" + d.slice(1);
  else if (d.startsWith("1") && d.length >= 9 && d.length <= 10) d = "60" + d;
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });

    // Parse as raw rows (no assumed header) so a plain "60…,Name" paste — with no header
    // line — still works. We then auto-detect whether the first row is a header.
    const csv = Papa.parse<string[]>(parsed.data.csv, { header: false, skipEmptyLines: true });
    if (csv.errors?.length && csv.data.length > 0) {
      return NextResponse.json({ error: "CSV_PARSE", details: csv.errors.slice(0, 5) }, { status: 400 });
    }

    const dataRows = csv.data.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()));

    // Header detection: if the first cell of the first row is a phone number, there's no
    // header — columns are positional (phone, name). Otherwise treat row 0 as a header and
    // locate the phone/name columns by common names (English + Malay).
    const PHONE_HEADERS = ["phone", "number", "phonenumber", "phone number", "mobile", "no", "hp", "telefon", "nombor"];
    const NAME_HEADERS = ["name", "fullname", "full name", "nama", "contact", "contact name"];
    let phoneIdx = 0;
    let nameIdx = 1;
    let startIdx = 0;
    let headerNames: string[] = [];
    const firstRow = dataRows[0] ?? [];
    const firstCellIsPhone = normalisePhone(String(firstRow[0] ?? "")) != null;
    if (!firstCellIsPhone && dataRows.length > 0) {
      const header = firstRow.map((h) => String(h ?? "").trim().toLowerCase());
      const p = header.findIndex((h) => PHONE_HEADERS.includes(h));
      const n = header.findIndex((h) => NAME_HEADERS.includes(h));
      phoneIdx = p >= 0 ? p : 0;
      nameIdx = n >= 0 ? n : 1;
      startIdx = 1; // skip the header row
      headerNames = firstRow.map((h) => String(h ?? "").trim());
    }

    const rows: Row[] = dataRows.slice(startIdx).map((r) => {
      // Capture every other column into customFields, keyed by its (original) header name.
      let customFields: Record<string, string> | undefined;
      if (headerNames.length) {
        const cf: Record<string, string> = {};
        for (let j = 0; j < r.length && Object.keys(cf).length < 30; j++) {
          if (j === phoneIdx || j === nameIdx) continue;
          const key = headerNames[j];
          const val = String(r[j] ?? "").trim();
          if (key && val && val.length <= 500) cf[key] = val;
        }
        if (Object.keys(cf).length) customFields = cf;
      }
      return {
        phone: String(r[phoneIdx] ?? "").trim(),
        name: String(r[nameIdx] ?? "").trim() || undefined,
        customFields,
      };
    }).filter((r) => r.phone);

    const map = new Map<string, Row>();
    for (const r of rows) {
      const n = normalisePhone(r.phone);
      if (!n) continue;
      if (!map.has(n)) map.set(n, { phone: n, name: r.name, customFields: r.customFields });
    }
    const candidates = Array.from(map.values());
    if (candidates.length === 0) {
      return NextResponse.json({ error: "NO_VALID_ROWS" }, { status: 400 });
    }

    const db = tenantClient(workspace.id);

    let surviving = candidates;
    if (parsed.data.validate) {
      const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
      if (!instance) throw new NotFoundError("Instance not found");
      const base = process.env.EVOLUTION_BASE_URL;
      if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
      const api = new ContactApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
      const valid = new Set<string>();
      for (let i = 0; i < candidates.length; i += 100) {
        const slice = candidates.slice(i, i + 100).map((r) => r.phone);
        const checks = await api.checkNumbers(instance.evolutionInstanceName, slice);
        for (const c of checks) if (c.exists) valid.add(c.number);
      }
      surviving = candidates.filter((r) => valid.has(r.phone));
    }

    const survivingIds: string[] = [];
    for (const r of surviving) {
      const contact = await db.contact.upsert({
        where: { workspaceId_phoneE164: { workspaceId: workspace.id, phoneE164: r.phone } } as any,
        create: { phoneE164: r.phone, name: r.name ?? null, customFields: r.customFields ?? undefined } as any,
        update: { name: r.name ?? undefined, customFields: r.customFields ?? undefined },
      });
      survivingIds.push(contact.id);
    }

    // Best-effort: add surviving contacts to a named list if requested.
    let listError: string | undefined;
    const listNameTrimmed = parsed.data.listName?.trim();
    if (listNameTrimmed && survivingIds.length > 0) {
      try {
        let list = await db.contactList.findFirst({ where: { name: listNameTrimmed } });
        if (!list) {
          list = await db.contactList.create({ data: { name: listNameTrimmed } as any });
        }
        await db.contactListMember.createMany({
          data: survivingIds.map((contactId) => ({ listId: list!.id, contactId })),
          skipDuplicates: true,
        } as any);
      } catch (listErr) {
        // Surface the failure but don't abort the import.
        listError = listErr instanceof Error ? listErr.message : String(listErr);
      }
    }

    return NextResponse.json({
      candidates: candidates.length,
      surviving: surviving.length,
      inserted: surviving.length,
      ...(listError ? { listError } : {}),
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
