import { headers } from "next/headers";
import Link from "next/link";
import { KeyRound, Smartphone, Send, Webhook, ArrowLeftRight, AlertTriangle, Sparkles, Users } from "lucide-react";
import { CodeBlock } from "./code-block";

export const metadata = { title: "API Documentation" };

// Endpoints a tenant calls externally, grouped by area for easy navigation. All
// are under {base}/api/workspaces/{slug} and authenticate with a workspace API
// key (Bearer ek_…). Kept in sync with the routes under
// apps/web/src/app/api/workspaces/[slug]/… (schemas verified against each route).
type Endpoint = { method: string; path: string; purpose: string; body?: string };
const ENDPOINT_GROUPS: { title: string; endpoints: Endpoint[] }[] = [
  {
    title: "Instances — your WhatsApp numbers",
    endpoints: [
      { method: "GET", path: "/instances", purpose: "List your numbers" },
      { method: "GET", path: "/instances/{id}", purpose: "One number's details" },
      { method: "GET", path: "/instances/{id}/state", purpose: "Live connection state (open / connecting / close)" },
      { method: "GET", path: "/instances/{id}/qr", purpose: "Pairing QR to connect a number" },
    ],
  },
  {
    title: "Send messages",
    endpoints: [
      { method: "POST", path: "/instances/{id}/send-test", purpose: "Send a text message", body: '{ "to": "60123456789", "text": "Hello 👋" }' },
      { method: "POST", path: "/instances/{id}/send", purpose: "Send text OR media (image / video / document / audio) to a phone", body: '{ "to": "60123456789", "type": "image", "media_url": "https://…/x.png", "message": "Hi" }' },
      { method: "POST", path: "/instances/{id}/send-group", purpose: "Send text OR media to a WhatsApp GROUP", body: '{ "groupId": "120363…@g.us", "message": "Hi group 👋" }' },
      { method: "GET", path: "/groups?instanceId={id}", purpose: "List your groups (with their group ids / JIDs) — the number must be connected" },
    ],
  },
  {
    title: "Contacts",
    endpoints: [
      { method: "GET", path: "/contacts", purpose: "List / search contacts ( ?q= , ?labelId= )" },
      { method: "POST", path: "/contacts", purpose: "Create a contact", body: '{ "phoneE164": "60123456789", "name": "Ali", "labelIds": [] }' },
      { method: "PUT / DELETE", path: "/contacts/{id}", purpose: "Update or delete a contact" },
      { method: "POST", path: "/contacts/import", purpose: "Bulk import from CSV (optionally WA-validate)", body: '{ "instanceId": "…", "csv": "phone,name\\n60123…,Ali", "validate": true }' },
      { method: "POST", path: "/contacts/validate", purpose: "Check which numbers are on WhatsApp", body: '{ "instanceId": "…", "numbers": ["60123456789"] }' },
    ],
  },
  {
    title: "Lists — audiences for broadcasts",
    endpoints: [
      { method: "GET", path: "/lists", purpose: "List contact lists" },
      { method: "POST", path: "/lists", purpose: "Create a list", body: '{ "name": "VIP customers" }' },
      { method: "GET / PUT / DELETE", path: "/lists/{id}", purpose: "Read, rename, or delete a list" },
      { method: "POST / DELETE", path: "/lists/{id}/members", purpose: "Add or remove contacts", body: '{ "contactIds": ["…", "…"] }' },
    ],
  },
  {
    title: "Labels",
    endpoints: [
      { method: "GET", path: "/labels", purpose: "List labels" },
      { method: "POST", path: "/labels", purpose: "Create a label", body: '{ "name": "Lead", "colour": "#22c55e" }' },
    ],
  },
  {
    title: "Broadcasts",
    endpoints: [
      { method: "GET", path: "/broadcasts", purpose: "List broadcasts" },
      { method: "POST", path: "/broadcasts", purpose: "Create a broadcast to a list", body: '{ "name": "Promo", "instanceId": "…", "listId": "…", "templateId": "…" }' },
      { method: "GET", path: "/broadcasts/{id}", purpose: "Status & sent/failed counts" },
      { method: "POST", path: "/broadcasts/{id}/start", purpose: "Start / resume a broadcast" },
      { method: "POST", path: "/broadcasts/{id}/cancel", purpose: "Cancel a running broadcast" },
    ],
  },
  {
    title: "Templates",
    endpoints: [
      { method: "GET", path: "/templates", purpose: "List message templates" },
      { method: "POST", path: "/templates", purpose: "Create a template ( {{name}} merge tags )", body: '{ "name": "Welcome", "body": "Hi {{name}} 👋" }' },
    ],
  },
  {
    title: "Conversations — the inbox",
    endpoints: [
      { method: "GET", path: "/conversations", purpose: "List inbox threads" },
      { method: "GET", path: "/conversations/{id}", purpose: "One thread with its messages" },
      { method: "POST", path: "/conversations/{id}/messages", purpose: "Reply inside a conversation", body: '{ "text": "Thanks for reaching out!" }' },
      { method: "POST", path: "/conversations/{id}/status", purpose: "Set open / pending / closed" },
      { method: "POST", path: "/conversations/{id}/assign", purpose: "Assign the thread to an agent" },
    ],
  },
  {
    title: "Media / files",
    endpoints: [
      { method: "GET", path: "/media", purpose: "List uploaded media" },
      { method: "POST", path: "/media", purpose: "Upload a file (multipart form-data) → a hosted URL you can send" },
    ],
  },
  {
    title: "Number health",
    endpoints: [
      { method: "GET", path: "/health", purpose: "Health & risk of all your numbers" },
      { method: "GET", path: "/health/instances/{id}", purpose: "One number's health, warm-up ramp & daily limits" },
    ],
  },
  {
    title: "Webhooks — event subscriptions",
    endpoints: [
      { method: "GET", path: "/webhook-subscriptions", purpose: "List your webhook subscriptions" },
      { method: "POST", path: "/webhook-subscriptions", purpose: "Subscribe a URL to events (returns a whsec_ secret once)", body: '{ "url": "https://…/hook", "events": ["message.received"] }' },
    ],
  },
];

const OUTBOUND_EVENTS = [
  "message.received", "message.sent", "message.status", "instance.state",
  "broadcast.completed", "broadcast.failed", "health.at_risk", "health.auto_protected", "health.ramp_cap_reached",
];

function Section({ id, icon: Icon, title, children }: { id: string; icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold border-b pb-2">
        <Icon className="h-5 w-5 text-primary" /> {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ApiDocsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const h = await headers();
  const host = h.get("host") ?? "your-domain";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const base = `${origin}/api/workspaces/${workspaceSlug}`;

  const sendExample = `curl -X POST "${base}/instances/{INSTANCE_ID}/send-test" \\
  -H "Authorization: Bearer ek_XXXXXXXXXXXXXXXX" \\
  -H "Content-Type: application/json" \\
  -d '{ "to": "60123456789", "text": "Hello from the API 👋" }'`;

  const sendImageExample = `curl -X POST "${base}/instances/{INSTANCE_ID}/send" \\
  -H "Authorization: Bearer ek_XXXXXXXXXXXXXXXX" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "60123456789",
    "type": "image",
    "mediaUrl": "https://your-domain/uploads/flyer.png",
    "caption": "Terima kasih kerana berminat 😊"
  }'`;

  const n8nBody = `{
  "number": "{{ $json['Phone Number'] }}",
  "type": "image",
  "media_url": "https://…/flyer.png",
  "message": "Terima kasih kerana berminat…"
}`;

  const listGroupsExample = `curl "${base}/groups?instanceId={INSTANCE_ID}" \\
  -H "Authorization: Bearer ek_XXXXXXXXXXXXXXXX"
# → { "groups": [ { "id": "120363012345678901@g.us", "subject": "My Group", "size": 42 }, … ] }`;

  const sendGroupExample = `curl -X POST "${base}/instances/{INSTANCE_ID}/send-group" \\
  -H "Authorization: Bearer ek_XXXXXXXXXXXXXXXX" \\
  -H "Content-Type: application/json" \\
  -d '{
    "groupId": "120363012345678901@g.us",
    "message": "Hello everyone 👋"
  }'`;

  const sendGroupImageExample = `curl -X POST "${base}/instances/{INSTANCE_ID}/send-group" \\
  -H "Authorization: Bearer ek_XXXXXXXXXXXXXXXX" \\
  -H "Content-Type: application/json" \\
  -d '{
    "groupId": "120363012345678901@g.us",
    "type": "image",
    "media_url": "https://your-domain/uploads/flyer.png",
    "message": "Poster minggu ini 🎉"
  }'`;

  const verifyExample = `// Verify an incoming webhook (Node.js)
import crypto from "node:crypto";

function isValid(rawBody, headers, secret) {
  const sig = headers["x-webhook-signature"]; // "sha256=<hex>"
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)      // your whsec_… subscription secret
    .update(rawBody)                    // the exact raw JSON body
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}`;

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">API &amp; Webhook Documentation</h1>
        <p className="text-muted-foreground">
          Automate this workspace over HTTP — send messages, manage contacts, launch broadcasts, and receive real-time events.
          Every request is scoped to <span className="font-medium text-foreground">this workspace</span>.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-sm">
          {[
            ["ids", "IDs & keys"], ["auth", "Authentication"], ["instance-id", "Instance ID"], ["send", "Send a message"],
            ["groups", "Send to a group"], ["endpoints", "All endpoints"], ["inbound", "Inbound webhooks"], ["outbound", "Outbound webhooks"], ["ai", "AI setup"], ["errors", "Errors"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground hover:bg-secondary/60">
              {label}
            </a>
          ))}
        </div>
      </header>

      <div className="rounded-md border bg-muted/40 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Base URL</div>
        <CodeBlock code={base} />
        <p className="text-xs text-muted-foreground">All endpoints below are relative to this base URL.</p>
      </div>

      <Section id="ids" icon={KeyRound} title="Identifiers &amp; keys — don't mix these up">
        <p className="text-sm text-muted-foreground">
          There are only two kinds of value: an <strong>ID</strong> that names a WhatsApp number (not secret), and a
          <strong> key</strong> that proves who you are (secret). Two of these terms are the same thing.
        </p>
        <div className="text-sm font-medium">IDs — name a number</div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-2">Term</th><th className="p-2">Example</th><th className="p-2">Where to find</th></tr></thead>
            <tbody className="divide-y">
              <tr className="align-top"><td className="p-2"><strong>Instance ID</strong> = <strong>cuid</strong></td><td className="p-2 font-mono text-xs">cmrir6sg40003ob0ykczduya3</td><td className="p-2 text-muted-foreground">Instances → open a number → in the page URL. Same thing as "cuid".</td></tr>
              <tr className="align-top"><td className="p-2">Evolution instance name</td><td className="p-2 font-mono text-xs">{workspaceSlug}-iphone-11-df06…</td><td className="p-2 text-muted-foreground">The engine's name. You may pass this <em>or</em> the cuid as <code className="rounded bg-muted px-1">instanceId</code>.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="text-sm font-medium pt-1">Keys — authenticate you</div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-2">Term</th><th className="p-2">Example</th><th className="p-2">Use in the API?</th></tr></thead>
            <tbody className="divide-y">
              <tr className="align-top"><td className="p-2"><strong>Workspace API key</strong> = <strong>Access token</strong></td><td className="p-2 font-mono text-xs">ek_oOw…</td><td className="p-2"><span className="text-success font-medium">✓ Yes</span> — <code className="rounded bg-muted px-1">Authorization: Bearer ek_…</code>. Create in Settings → API keys.</td></tr>
              <tr className="align-top"><td className="p-2">Instance API key (Evolution engine key)</td><td className="p-2 font-mono text-xs">D74EB929-90B9-… (GUID)</td><td className="p-2"><span className="text-destructive font-medium">✗ No</span> — internal engine key shown on the instance page. Never use it here.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm">
          In short: put the <code className="rounded bg-muted px-1">ek_…</code> key in <code className="rounded bg-muted px-1">Authorization: Bearer</code>,
          and the <code className="rounded bg-muted px-1">instanceId</code> (cuid or name) + group JID in the URL. The <code className="rounded bg-muted px-1">D74EB929-…</code> GUID is not used here.
        </p>
      </Section>

      <Section id="auth" icon={KeyRound} title="1. Authentication (your access token)">
        <p className="text-sm">
          The <strong>access token</strong> is a <strong>workspace API key</strong>. Create one in{" "}
          <Link href={`/${workspaceSlug}/settings/api-keys`} className="text-primary underline">Settings → API keys</Link>.
          The raw key (prefix <code className="rounded bg-muted px-1">ek_</code>) is shown <strong>once</strong> on creation — copy and store it securely.
        </p>
        <p className="text-sm">Send it on every request in the <code className="rounded bg-muted px-1">Authorization</code> header:</p>
        <CodeBlock code={`Authorization: Bearer ek_XXXXXXXXXXXXXXXX`} />
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
          <li>An API key acts with <strong>Admin</strong> permissions on this workspace (it can send, broadcast, and manage contacts — but not Owner-only actions like billing or deleting the workspace).</li>
          <li>Keep it server-side. Anyone with the key can message from your numbers. Revoke a leaked key from the same settings page.</li>
          <li>The per-instance <em>Evolution API key</em> shown on an instance page is a different, internal engine key — do <strong>not</strong> use it here.</li>
        </ul>
      </Section>

      <Section id="instance-id" icon={Smartphone} title="2. Finding your Instance ID">
        <p className="text-sm">
          Most messaging calls need an <strong>instance ID</strong> — the WhatsApp number you send from. Open{" "}
          <Link href={`/${workspaceSlug}/instances`} className="text-primary underline">Instances</Link>, click a number, and copy the ID
          from the page URL: <code className="rounded bg-muted px-1">/{workspaceSlug}/instances/<strong>&#123;INSTANCE_ID&#125;</strong></code>.
          Or list them programmatically:
        </p>
        <CodeBlock code={`curl "${base}/instances" -H "Authorization: Bearer ek_XXXX"`} />
        <p className="text-sm text-muted-foreground">The instance must be <strong>connected</strong> (state <code className="rounded bg-muted px-1">open</code>) to send. Check with <code className="rounded bg-muted px-1">GET /instances/&#123;id&#125;/state</code>.</p>
      </Section>

      <Section id="send" icon={Send} title="3. Send a WhatsApp message">
        <p className="text-sm">Send a <strong>text</strong> from one of your numbers to any phone (international format, no <code className="rounded bg-muted px-1">+</code> or spaces):</p>
        <CodeBlock code={sendExample} />

        <p className="text-sm pt-1">Send an <strong>image or file</strong> by URL — use <code className="rounded bg-muted px-1">POST /instances/&#123;id&#125;/send</code> with a <code className="rounded bg-muted px-1">type</code> of <code className="rounded bg-muted px-1">image</code>, <code className="rounded bg-muted px-1">video</code>, <code className="rounded bg-muted px-1">document</code>, or <code className="rounded bg-muted px-1">audio</code>. The <code className="rounded bg-muted px-1">mediaUrl</code> must be publicly reachable (the engine downloads it); upload to <Link href={`/${workspaceSlug}/files`} className="text-primary underline">File Manager</Link> for a hosted link, or use any public URL.</p>
        <CodeBlock code={sendImageExample} />
        <p className="text-sm text-muted-foreground">
          Success returns <code className="rounded bg-muted px-1">{'{ "status": "success", "messageId": "…", "to": "…", "delivery": "sent" }'}</code>.
          Failure returns the matching HTTP code with <code className="rounded bg-muted px-1">{'{ "status": "error", "code": 4xx, "message": "…" }'}</code>.
          <br /><span className="text-xs">Note: <code className="rounded bg-muted px-1">"sent"</code> means WhatsApp <em>accepted</em> the message — real delivered/read confirmations arrive later via the <code className="rounded bg-muted px-1">message.status</code> webhook. Sending is rate-limited per number; a burst may return <code className="rounded bg-muted px-1">429</code>.</span>
        </p>

        <div className="rounded-md border bg-muted/40 p-4 space-y-2">
          <div className="text-sm font-medium">Using it from n8n / Zapier / Make</div>
          <p className="text-sm text-muted-foreground">Point an <strong>HTTP Request</strong> node at <code className="rounded bg-muted px-1">POST {base}/instances/&#123;INSTANCE&#125;/send</code>, add the <code className="rounded bg-muted px-1">Authorization: Bearer ek_…</code> header, and post JSON. Migrating from another tool? This endpoint <strong>also accepts the common alias field names</strong>, so you mostly just move two values:</p>
          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left"><tr><th className="p-2">If your old body had…</th><th className="p-2">Put it…</th></tr></thead>
              <tbody className="divide-y">
                <tr className="align-top"><td className="p-2 font-mono text-xs">access_token</td><td className="p-2">→ the <code className="rounded bg-muted px-1">Authorization: Bearer ek_…</code> <strong>header</strong> (remove from body)</td></tr>
                <tr className="align-top"><td className="p-2 font-mono text-xs">instance_id</td><td className="p-2">→ in the <strong>URL</strong> (instance name or id; remove from body)</td></tr>
                <tr className="align-top"><td className="p-2 font-mono text-xs">number</td><td className="p-2">kept as-is (alias for <code className="rounded bg-muted px-1">to</code>)</td></tr>
                <tr className="align-top"><td className="p-2 font-mono text-xs">type</td><td className="p-2">kept as-is (<code className="rounded bg-muted px-1">text</code> / <code className="rounded bg-muted px-1">image</code> / …)</td></tr>
                <tr className="align-top"><td className="p-2 font-mono text-xs">message</td><td className="p-2">kept as-is (alias for <code className="rounded bg-muted px-1">caption</code> / <code className="rounded bg-muted px-1">text</code>)</td></tr>
                <tr className="align-top"><td className="p-2 font-mono text-xs">media_url</td><td className="p-2">kept as-is (alias for <code className="rounded bg-muted px-1">mediaUrl</code>)</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">So an existing image body becomes just this (delete <code className="rounded bg-muted px-1">access_token</code> + <code className="rounded bg-muted px-1">instance_id</code>, add the header):</p>
          <CodeBlock code={n8nBody} />
        </div>
      </Section>

      <Section id="groups" icon={Users} title="4. Send to a WhatsApp group">
        <p className="text-sm">
          Sending to a group works just like sending to a person — but the recipient is the group&apos;s{" "}
          <strong>group id</strong> (a JID ending in <code className="rounded bg-muted px-1">@g.us</code>) instead of a phone number.
          Use <code className="rounded bg-muted px-1">POST /instances/&#123;id&#125;/send-group</code> (the <code className="rounded bg-muted px-1">/send_group</code> equivalent).
        </p>

        <div className="text-sm font-medium">Step 1 — find the group id</div>
        <p className="text-sm text-muted-foreground">List the groups the number belongs to (the number must be connected). Copy the <code className="rounded bg-muted px-1">id</code> you want:</p>
        <CodeBlock code={listGroupsExample} />

        <div className="text-sm font-medium pt-1">Step 2 — send text to the group</div>
        <CodeBlock code={sendGroupExample} />

        <div className="text-sm font-medium pt-1">Send an image / file to the group</div>
        <CodeBlock code={sendGroupImageExample} />
        <p className="text-sm text-muted-foreground">
          Same fields as <code className="rounded bg-muted px-1">/send</code> (<code className="rounded bg-muted px-1">type</code>,{" "}
          <code className="rounded bg-muted px-1">media_url</code>, <code className="rounded bg-muted px-1">message</code>) and the same success/error envelope —
          only <code className="rounded bg-muted px-1">to</code> becomes <code className="rounded bg-muted px-1">groupId</code>. You may pass the full JID
          (<code className="rounded bg-muted px-1">120363…@g.us</code>) or just the numeric id — the <code className="rounded bg-muted px-1">@g.us</code> is added for you.
          Aliases <code className="rounded bg-muted px-1">group_id</code> / <code className="rounded bg-muted px-1">to</code> also work.
        </p>
      </Section>

      <Section id="endpoints" icon={ArrowLeftRight} title="5. All endpoints (by area)">
        <p className="text-sm text-muted-foreground">
          Every endpoint below is relative to the base URL and requires the <code className="rounded bg-muted px-1">Authorization: Bearer ek_…</code> header.
          Replace <code className="rounded bg-muted px-1">&#123;id&#125;</code>/<code className="rounded bg-muted px-1">&#123;INSTANCE_ID&#125;</code> with a real ID.
        </p>
        <div className="space-y-4">
          {ENDPOINT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="text-sm font-semibold">{group.title}</div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>
                      <th className="p-2 w-28">Method</th>
                      <th className="p-2">Path</th>
                      <th className="p-2">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {group.endpoints.map((e) => (
                      <tr key={e.method + e.path} className="align-top hover:bg-accent/30">
                        <td className="p-2">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${e.method.startsWith("GET") ? "bg-blue-500/15 text-blue-600" : "bg-emerald-500/15 text-emerald-600"}`}>{e.method}</span>
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {e.path}
                          {e.body && <div className="mt-1 text-muted-foreground">body: {e.body}</div>}
                        </td>
                        <td className="p-2 text-muted-foreground">{e.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="inbound" icon={Webhook} title="6. Inbound webhooks (receiving events into the app)">
        <p className="text-sm">
          When you connect a number, an inbound webhook is <strong>automatically registered</strong> with the WhatsApp engine — incoming messages
          flow into your Inbox and trigger your automations with no setup needed.
        </p>
        <p className="text-sm">
          To let an <strong>external system</strong> (e.g. a billing or CRM app) trigger a WhatsApp message, create an{" "}
          <Link href={`/${workspaceSlug}/settings/integrations`} className="text-primary underline">Inbound Integration</Link>. You get a unique URL:
        </p>
        <CodeBlock code={`POST ${origin.replace(/:\d+$/, "")}/integration_webhook/{YOUR_INTEGRATION_TOKEN}`} />
        <p className="text-sm text-muted-foreground">
          POST any JSON to it. The integration maps a field (e.g. <code className="rounded bg-muted px-1">billing.billing_phone</code>) to the recipient and
          renders your caption template into a message. The token in the URL is the auth — no header needed. The exact URL is shown when you create the integration.
        </p>
      </Section>

      <Section id="outbound" icon={ArrowLeftRight} title="7. Outbound webhooks (events pushed to your URL)">
        <p className="text-sm">
          Subscribe your own HTTPS endpoint in{" "}
          <Link href={`/${workspaceSlug}/settings/integrations`} className="text-primary underline">Settings → Integrations → Webhooks</Link>{" "}
          to receive real-time events. On creation you get a signing secret (prefix <code className="rounded bg-muted px-1">whsec_</code>), shown once.
        </p>
        <div>
          <div className="text-sm font-medium mb-1">Available events</div>
          <div className="flex flex-wrap gap-1.5">
            {OUTBOUND_EVENTS.map((ev) => <code key={ev} className="rounded bg-muted px-1.5 py-0.5 text-xs">{ev}</code>)}
          </div>
        </div>
        <p className="text-sm">Each delivery is a JSON <code className="rounded bg-muted px-1">POST</code> with this envelope and headers:</p>
        <CodeBlock code={`POST (your URL)
Content-Type: application/json
x-webhook-event: message.received
x-webhook-id: <unique delivery id>
x-webhook-timestamp: <ISO 8601>
x-webhook-signature: sha256=<HMAC-SHA256 hex of the raw body>

{
  "event": "message.received",
  "at": "2026-01-01T09:00:00.000Z",
  "data": { "instanceId": "…", "conversationId": "…", "from": "60123…", "name": "Ali", "type": "text", "body": "Hi" }
}`} />
        <p className="text-sm">Verify the signature with your <code className="rounded bg-muted px-1">whsec_</code> secret before trusting a payload:</p>
        <CodeBlock code={verifyExample} />
        <p className="text-sm text-muted-foreground">Failed deliveries retry up to 5 times with exponential backoff. Respond <code className="rounded bg-muted px-1">2xx</code> quickly to acknowledge.</p>
      </Section>

      <Section id="errors" icon={AlertTriangle} title="8. Errors &amp; status codes">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-2 w-24">Status</th><th className="p-2">Meaning</th></tr></thead>
            <tbody className="divide-y">
              {[
                ["401", "Missing or invalid API key (Authorization header)."],
                ["402 PLAN_CAP_REACHED", "Your plan's number / contact / message cap was hit."],
                ["403", "The key lacks permission (Owner-only action)."],
                ["404", "Workspace, instance, or resource not found."],
                ["409", "The number is not connected — reconnect it (Instances → scan QR). Also used for conflicts like a duplicate contact."],
                ["429 THROTTLED", "Sending too fast for this number — back off and retry."],
                ["502 SEND_FAILED", "The WhatsApp engine rejected or failed the send."],
              ].map(([code, meaning]) => (
                <tr key={code} className="align-top">
                  <td className="p-2 font-mono text-xs">{code}</td>
                  <td className="p-2 text-muted-foreground">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Errors return JSON like <code className="rounded bg-muted px-1">{"{ \"error\": \"THROTTLED\" }"}</code>.</p>
      </Section>

      <Section id="ai" icon={Sparkles} title="AI setup (chatbot &amp; warmer)">
        <p className="text-sm">
          The AI features (chatbot replies, number warmer) run on an AI provider you configure in{" "}
          <Link href={`/${workspaceSlug}/settings/integrations/ai`} className="text-primary underline">Settings → Integrations → AI</Link>.
          You can set a <strong>different provider per feature</strong> using the <em>Default / Warmer / Chatbot</em> tabs.
        </p>

        <div className="text-sm font-medium">Supported providers</div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-2">Provider</th><th className="p-2">Get a key</th><th className="p-2">Cost</th><th className="p-2">Suggested model</th></tr></thead>
            <tbody className="divide-y">
              {[
                ["Google Gemini", "aistudio.google.com → Get API key", "Free tier / student", "gemini-2.5-flash"],
                ["Ollama", "ollama.com key (or blank for self-hosted)", "Free-ish", "gpt-oss:20b"],
                ["Grok (xAI)", "console.x.ai", "Free tier", "grok-3-mini"],
                ["Anthropic Claude", "console.anthropic.com", "Paid", "claude-haiku-4-5"],
                ["OpenAI", "platform.openai.com", "Paid", "gpt-4o-mini"],
              ].map((r) => (
                <tr key={r[0]} className="align-top">
                  <td className="p-2 font-medium">{r[0]}</td>
                  <td className="p-2 text-muted-foreground">{r[1]}</td>
                  <td className="p-2 text-muted-foreground">{r[2]}</td>
                  <td className="p-2 font-mono text-xs">{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-sm font-medium pt-1">Setup</div>
        <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
          <li>Open <strong>Settings → Integrations → AI</strong>, choose a tab: <strong>Default</strong> (used everywhere unless overridden), <strong>Warmer</strong>, or <strong>Chatbot</strong>.</li>
          <li>Pick a <strong>Provider</strong>, paste the <strong>API key</strong>, and select a <strong>Model</strong> (Ollama shows its live model list; others show a shortlist + Custom).</li>
          <li>For Ollama, set the <strong>Endpoint</strong> (<code className="rounded bg-muted px-1">https://ollama.com</code> for cloud, or your local URL). Click <strong>Save</strong>.</li>
        </ol>

        <div className="text-sm font-medium pt-1">Using it</div>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li><strong>Chatbot</strong> (Automation → Chatbot → Settings): set <em>AI fallback = On</em>. It answers when no keyword rule matches, grounded in your <Link href={`/${workspaceSlug}/settings/knowledge`} className="underline">Knowledge base</Link>.</li>
          <li><strong>Warmer</strong> (Automation → Warmer): enable <em>AI conversations</em> — it uses the Warmer-scope provider (or Default).</li>
        </ul>
        <p className="text-sm">
          <strong>Recommended:</strong> Gemini for the Chatbot (free + high quality) and Ollama for the Warmer (small-talk quality doesn&apos;t matter).
        </p>
      </Section>
    </div>
  );
}
