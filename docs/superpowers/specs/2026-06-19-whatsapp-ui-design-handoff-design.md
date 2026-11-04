# UI Design Handoff Package — Design Spec

**Date:** 2026-06-19
**Status:** Approved (pending spec review)
**Goal:** Prepare a complete handoff package so a "design-Claude" (claude.ai artifacts or a focused Claude Code session) can design the UI of Evolution Manager to an industry-leading standard, with output that drops straight into this codebase.

## Problem

Evolution Manager is functionally built but visually unskinned. The README claims "shadcn/ui + Tailwind," but the reality is:

- `tailwind.config.ts` has an empty theme (no palette, radii, type scale).
- `globals.css` is 6 lines (system font + full height only).
- `src/components/` is empty — no shadcn primitives; pages render raw `<h1>`/`<p>`.
- No icon library, no `class-variance-authority` / `tailwind-merge` / Radix, no motion library.
- The app shell is a plain `bg-gray-100` sidebar with unstyled text links.

It looks dull because it was never skinned, not because of bad design choices. This is the easy starting point: install an aesthetic rather than fight one.

## Decisions (locked during brainstorming)

- **Deliverable:** Both a design brief *and* a scaffolded code foundation (a "brief + mould" handoff).
- **Aesthetic:** WhatsApp-native.
- **Brand:** Clean slate — free to define.
- **Theme:** Dark-first (light mode wired via CSS variables for a future free swap).
- **Reference screens fully skinned:** Dashboard (general pattern language) + Inbox chat thread (signature WhatsApp surface).

## Part A — Design Brief (`docs/design/UI-BRIEF.md`)

A single self-contained Markdown file to paste into a design-Claude as full context. Sections:

1. **Product summary** — what Evolution Manager is, who uses it (multi-tenant WhatsApp manager for agencies/schools), core jobs-to-be-done.
2. **Visual direction** — WhatsApp-native, dark-first: mood, do's/don'ts, references to emulate (WhatsApp Web/Desktop dark, plus Linear/Resend-grade polish for non-chat surfaces).
3. **Design tokens** — the exact palette, type scale, radii, spacing, shadows (mirrors the code tokens so mockups match implementation).
4. **Screen inventory** — every route, each with purpose, key data shown, primary actions, and required states (empty / loading / error). Routes derived from `apps/web/src/app/[workspaceSlug]/*`, `/admin/*`, `(auth)`, and `onboarding`.
5. **Component checklist** — nav shell, cards, tables, forms, chat thread, charts, modals, toasts, badges, avatars, skeletons.
6. **Stack constraints** — Next 15 App Router + RSC, Tailwind, shadcn/ui, lucide-react; design must be implementable, not just pretty.

## Part B — Code Scaffold

**1. Design tokens & theme.** Rewrite `tailwind.config.ts` + `globals.css` with the WhatsApp-dark system as CSS variables (shadcn convention; light mode a future swap):

- Surfaces: base `#0B141A`, raised panels `#111B21`, hover `#202C33`.
- Accent: WhatsApp green `#00A884` (primary), sent-bubble green `#005C4B`, teal-tint links.
- Text: `#E9EDEF` (high contrast), `#8696A0` (muted).
- Named tokens for radii, spacing, shadows, and a type scale.

**2. shadcn/ui foundation.** Install the dependencies the README only claims: `class-variance-authority`, `tailwind-merge`, `clsx`, `tailwindcss-animate`, required Radix primitives, `lucide-react`; add a `cn()` util. Generate core primitives into `src/components/ui/`: button, card, input, label, table, dialog, dropdown-menu, badge, avatar, tabs, toast (+ toaster), skeleton.

**3. App shell.** Replace the plain sidebar with a proper navigation shell: icon + label nav with active-state highlighting, workspace-switcher slot, topbar with user menu. This frames every screen — highest-leverage piece.

**4. Reference screens.**
- **Dashboard** — fully skinned: stat cards, a chart via the existing `recharts`, recent-activity list. The general "design key."
- **Inbox chat thread** — fully skinned signature surface: conversation list pane + chat thread with WhatsApp-style bubbles, day separators, composer. Demonstrates the distinctive aesthetic.

**5. `src/components/ui/README.md`** — short composition notes so generated screens stay consistent.

## Constraints & non-goals

- Keep all existing i18n keys working (`next-intl`, en-GB). New copy adds keys to `apps/web/messages/en-GB.json`.
- RSC-first: primitives are client components only where interactivity requires it (`"use client"`).
- Do not change app logic, data fetching, auth, or routing — this is a presentation-layer scaffold only.
- Reference screens may use representative/mock data where live wiring isn't already present; mark such spots clearly so they're easy to wire later.
- Non-goal: skinning every screen. The package gives intent (brief) + mould (scaffold + 2 reference screens); design-Claude pattern-matches the rest.

## Success criteria

- `pnpm --filter @evo/web build` (or dev) compiles with the new theme and primitives.
- The app shell, dashboard, and inbox render in dark WhatsApp styling.
- `docs/design/UI-BRIEF.md` is complete (no TBDs) and self-contained.
- A design-Claude handed the brief + repo can produce new screens that visually match the reference screens without further explanation.

## Testing

- Build/typecheck passes.
- Manual: load `/[workspace]/dashboard` and `/[workspace]/inbox` in dark mode; verify shell, tokens, and primitives render.
- Existing Playwright happy-path still passes (no routing/logic changes).
