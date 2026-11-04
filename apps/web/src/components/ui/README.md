# UI primitives

shadcn/ui (New York) primitives styled with the WhatsApp-dark token system in
`src/app/globals.css`. **Always** import from `@/components/ui/<name>` and never
hard-code colors — use token classes (`bg-card`, `text-muted-foreground`,
`bg-primary`, `bg-bubble-out`, etc.) so light mode swaps for free.

## Composition rules
- Compose, don't fork: build screens from `Card`, `Button`, `Table`, `Tabs`,
  `Dialog`, `DropdownMenu`, `Badge`, `Avatar`, `Input`, `Label`, `Skeleton`.
- Use `cn()` from `@/lib/utils` to merge classes.
- Server Components by default. Add `"use client"` only when a component uses
  state, effects, or browser events (charts, dropdowns, chat composer).
- Icons: `lucide-react`, sized `h-4 w-4` inline / `h-5 w-5` in stat tiles.
- Loading: render `Skeleton`. Empty states: centered icon + muted caption
  (see the inbox empty state for the pattern).

## Reference screens (the mould)
- Dashboard: `src/app/[workspaceSlug]/dashboard/page.tsx` — stat grid + chart + list.
- Inbox: `src/components/inbox/chat-thread.tsx` — bubbles, header, composer.

New screens should pattern-match these.
