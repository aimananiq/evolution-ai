# WhatsApp UI Design Handoff Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a WhatsApp-native, dark-first design system into `apps/web` (tokens + shadcn primitives + app shell + two fully-skinned reference screens) and write a self-contained design brief, so a "design-Claude" can design the remaining UI with output that drops straight into the codebase.

**Architecture:** Presentation-layer only — no app logic, data, auth, or routing changes. Tailwind theme expressed as CSS variables (shadcn convention) so light mode is a future swap. shadcn/ui primitives live in `src/components/ui/`. A navigation shell wraps every workspace screen. Dashboard and Inbox are skinned as worked examples ("the mould").

**Tech Stack:** Next 15 (App Router, RSC), React 19, Tailwind 3.4, shadcn/ui (Radix + CVA + tailwind-merge), lucide-react, recharts (already present), next-intl (en-GB).

---

## File Structure

**Create:**
- `apps/web/src/lib/utils.ts` — `cn()` helper.
- `apps/web/src/components/ui/{button,card,input,label,table,dialog,dropdown-menu,badge,avatar,tabs,toast,toaster,skeleton}.tsx` — shadcn primitives.
- `apps/web/src/components/ui/README.md` — composition notes.
- `apps/web/src/components/shell/sidebar.tsx` — workspace nav sidebar (client; active-state).
- `apps/web/src/components/shell/topbar.tsx` — topbar with user menu.
- `apps/web/src/components/dashboard/stat-card.tsx` — reusable stat card.
- `apps/web/src/components/dashboard/activity-chart.tsx` — recharts wrapper (client).
- `apps/web/src/components/inbox/chat-thread.tsx` — WhatsApp-style chat thread (client).
- `docs/design/UI-BRIEF.md` — the design brief deliverable.

**Modify:**
- `apps/web/package.json` — add design-system deps.
- `apps/web/tailwind.config.ts` — full theme via CSS variables + tailwindcss-animate.
- `apps/web/src/app/globals.css` — token variables, dark default, base layer.
- `apps/web/src/app/layout.tsx` — set `dark` class + Toaster.
- `apps/web/src/app/[workspaceSlug]/layout.tsx` — use new shell.
- `apps/web/src/app/[workspaceSlug]/dashboard/page.tsx` — skinned dashboard.
- `apps/web/src/app/[workspaceSlug]/inbox/page.tsx` — pass an empty-state into skinned panel (keep data logic).
- `apps/web/messages/en-GB.json` — add new copy keys.

---

## Task 1: Install design-system dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add dependencies**

Run from repo root:

```bash
pnpm --filter @evo/web add class-variance-authority tailwind-merge clsx tailwindcss-animate lucide-react @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-avatar @radix-ui/react-tabs @radix-ui/react-toast @radix-ui/react-slot
```

- [ ] **Step 2: Verify install**

Run: `pnpm --filter @evo/web exec node -e "require('class-variance-authority');require('lucide-react');console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add shadcn/ui + lucide design-system deps"
```

---

## Task 2: Design tokens — Tailwind theme, globals, cn util

**Files:**
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Write `cn()` util**

`apps/web/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Replace `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        sidebar: { DEFAULT: "hsl(var(--sidebar))", foreground: "hsl(var(--sidebar-foreground))" },
        bubble: { out: "hsl(var(--bubble-out))", in: "hsl(var(--bubble-in))" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: { "accordion-down": "accordion-down 0.2s ease-out", "accordion-up": "accordion-up 0.2s ease-out" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 3: Replace `globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* Dark-first: values are the defaults. :root carries the dark palette so the
     app renders WhatsApp-dark with no class needed; .light is the future swap. */
  :root {
    --background: 197 39% 8%;        /* #0B141A WhatsApp base */
    --foreground: 197 13% 90%;       /* #E9EDEF */
    --card: 198 28% 10%;             /* #111B21 raised panel */
    --card-foreground: 197 13% 90%;
    --popover: 198 28% 10%;
    --popover-foreground: 197 13% 90%;
    --primary: 168 100% 33%;         /* #00A884 WhatsApp green */
    --primary-foreground: 197 39% 8%;
    --secondary: 198 22% 16%;        /* #202C33 hover */
    --secondary-foreground: 197 13% 90%;
    --muted: 198 22% 16%;
    --muted-foreground: 197 11% 58%; /* #8696A0 */
    --accent: 198 22% 16%;
    --accent-foreground: 197 13% 90%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 98%;
    --border: 198 18% 18%;
    --input: 198 18% 18%;
    --ring: 168 100% 33%;
    --sidebar: 200 24% 9%;
    --sidebar-foreground: 197 13% 90%;
    --bubble-out: 169 100% 18%;      /* #005C4B sent bubble */
    --bubble-in: 198 28% 14%;        /* received bubble */
    --radius: 0.625rem;
  }

  .light {
    --background: 0 0% 100%;
    --foreground: 197 39% 12%;
    --card: 0 0% 100%;
    --card-foreground: 197 39% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 197 39% 12%;
    --primary: 168 100% 30%;
    --primary-foreground: 0 0% 100%;
    --secondary: 200 20% 96%;
    --secondary-foreground: 197 39% 12%;
    --muted: 200 20% 96%;
    --muted-foreground: 197 11% 40%;
    --accent: 200 20% 96%;
    --accent-foreground: 197 39% 12%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 98%;
    --border: 200 16% 88%;
    --input: 200 16% 88%;
    --ring: 168 100% 30%;
    --sidebar: 150 20% 97%;
    --sidebar-foreground: 197 39% 12%;
    --bubble-out: 145 64% 85%;
    --bubble-in: 0 0% 100%;
    --radius: 0.625rem;
  }

  * { @apply border-border; }
  html, body { height: 100%; }
  body {
    @apply bg-background text-foreground;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-feature-settings: "cv11", "ss01";
  }
}
```

- [ ] **Step 4: Verify tokens compile**

Run: `pnpm --filter @evo/web exec tailwindcss -i src/app/globals.css -o /tmp/out.css 2>&1 | tail -3`
Expected: no errors (a warning about content is acceptable); `/tmp/out.css` is generated.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/src/app/globals.css apps/web/src/lib/utils.ts
git commit -m "feat(web): WhatsApp-dark design tokens + cn util"
```

---

## Task 3: shadcn primitives

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/label.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/avatar.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/components/ui/table.tsx`
- Create: `apps/web/src/components/ui/tabs.tsx`
- Create: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/dropdown-menu.tsx`
- Create: `apps/web/src/components/ui/toast.tsx`
- Create: `apps/web/src/components/ui/toaster.tsx`
- Create: `apps/web/src/components/ui/use-toast.ts`

These are the standard shadcn/ui (New York) source files, which read the tokens from Task 2. Generate them. Below are the non-trivial ones in full; the rest are the canonical shadcn sources for these components.

- [ ] **Step 1: `button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 2: `card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

- [ ] **Step 3: `input.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 4: `label.tsx`**

```tsx
"use client";
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
```

- [ ] **Step 5: `badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 6: `avatar.tsx`**

```tsx
"use client";
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root ref={ref} className={cn("relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full", className)} {...props} />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full", className)} {...props} />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback ref={ref} className={cn("flex h-full w-full items-center justify-center rounded-full bg-secondary text-xs font-medium", className)} {...props} />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
```

- [ ] **Step 7: `skeleton.tsx`**

```tsx
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-secondary", className)} {...props} />;
}

export { Skeleton };
```

- [ ] **Step 8: `table.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
);
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)} {...props} />
  )
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn("h-10 px-2 text-left align-middle font-medium text-muted-foreground", className)} {...props} />
  )
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td ref={ref} className={cn("p-2 align-middle", className)} {...props} />
);
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
```

- [ ] **Step 9: `tabs.tsx`**

```tsx
"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow", className)} {...props} />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-2 focus-visible:outline-none", className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
```

- [ ] **Step 10: `dialog.tsx`, `dropdown-menu.tsx`, `toast.tsx`, `toaster.tsx`, `use-toast.ts`**

Generate the canonical shadcn/ui (New York) sources for these four components verbatim (they depend only on the matching Radix packages installed in Task 1, `cn`, and lucide-react icons). Reference: https://ui.shadcn.com/docs/components — copy `dialog`, `dropdown-menu`, `toast`, `toaster`, and the `use-toast` hook. Do not modify their class names; they already consume the Task 2 tokens.

- [ ] **Step 11: Verify primitives typecheck**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: no errors referencing `src/components/ui/*`.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/ui
git commit -m "feat(web): shadcn/ui primitive components"
```

---

## Task 4: Navigation shell (sidebar + topbar)

**Files:**
- Create: `apps/web/src/components/shell/sidebar.tsx`
- Create: `apps/web/src/components/shell/topbar.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx`
- Modify: `apps/web/messages/en-GB.json`

- [ ] **Step 1: Add nav `settings` copy key**

In `apps/web/messages/en-GB.json`, add to the existing `"nav"` object the key `"settings": "Settings"` (the other nav keys already exist).

- [ ] **Step 2: `sidebar.tsx` (client — needs active-route highlight)**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, MessageSquare, Users, FileText, Megaphone,
  Workflow, Flame, BarChart3, Smartphone, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

export function Sidebar({ workspaceSlug, labels }: { workspaceSlug: string; labels: Record<string, string> }) {
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;
  const items: Item[] = [
    { href: `${base}/dashboard`, label: labels.dashboard, icon: LayoutDashboard },
    { href: `${base}/inbox`, label: labels.inbox, icon: MessageSquare },
    { href: `${base}/contacts`, label: labels.contacts, icon: Users },
    { href: `${base}/templates`, label: labels.templates, icon: FileText },
    { href: `${base}/broadcasts`, label: labels.broadcasts, icon: Megaphone },
    { href: `${base}/automation`, label: labels.automation, icon: Workflow },
    { href: `${base}/warmer`, label: labels.warmer, icon: Flame },
    { href: `${base}/analytics`, label: labels.analytics, icon: BarChart3 },
    { href: `${base}/instances`, label: labels.instances, icon: Smartphone },
    { href: `${base}/settings/members`, label: labels.settings, icon: Settings },
  ];

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <MessageSquare className="h-4 w-4" />
        </div>
        <span className="font-semibold tracking-tight">Evolution</span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: `topbar.tsx`**

```tsx
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Topbar({ workspaceName }: { workspaceName: string }) {
  const initials = workspaceName.slice(0, 2).toUpperCase();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
      <span className="text-sm font-medium text-muted-foreground">{workspaceName}</span>
      <Avatar className="h-8 w-8">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    </header>
  );
}
```

- [ ] **Step 4: Rewrite `[workspaceSlug]/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenError } from "@evo/shared";
import { requireMember } from "@/lib/tenancy";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let workspace;
  try {
    ({ workspace } = await requireMember(workspaceSlug, "Viewer"));
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/sign-in");
    throw e;
  }
  const t = await getTranslations();
  const labels = {
    dashboard: t("nav.dashboard"), inbox: t("nav.inbox"), contacts: t("nav.contacts"),
    templates: t("nav.templates"), broadcasts: t("nav.broadcasts"), automation: t("nav.automation"),
    warmer: t("nav.warmer"), analytics: t("nav.analytics"), instances: t("nav.instances"),
    settings: t("nav.settings"),
  };
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar workspaceSlug={workspaceSlug} labels={labels} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar workspaceName={workspace.name} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify build of the shell**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/shell apps/web/src/app/'[workspaceSlug]'/layout.tsx apps/web/messages/en-GB.json
git commit -m "feat(web): WhatsApp-dark navigation shell (sidebar + topbar)"
```

---

## Task 5: Dashboard reference screen

**Files:**
- Create: `apps/web/src/components/dashboard/stat-card.tsx`
- Create: `apps/web/src/components/dashboard/activity-chart.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/dashboard/page.tsx`
- Modify: `apps/web/messages/en-GB.json`

- [ ] **Step 1: Add dashboard copy keys**

In `apps/web/messages/en-GB.json`, replace the `"dashboard"` object with:

```json
"dashboard": {
  "title": "Dashboard",
  "welcome": "Welcome to {workspace}",
  "statMessages": "Messages sent",
  "statContacts": "Contacts",
  "statDelivery": "Delivery rate",
  "statInstances": "Active instances",
  "activityTitle": "Messages over time",
  "recentTitle": "Recent activity",
  "recentEmpty": "No activity yet"
}
```

- [ ] **Step 2: `stat-card.tsx`**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label, value, delta, icon: Icon,
}: {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean };
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {delta && (
            <p className={cn("text-xs", delta.positive ? "text-primary" : "text-destructive")}>
              {delta.positive ? "▲" : "▼"} {delta.value}
            </p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `activity-chart.tsx` (client — recharts)**

```tsx
"use client";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export function ActivityChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(168 100% 33%)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(168 100% 33%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" stroke="hsl(197 11% 58%)" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "hsl(198 28% 10%)", border: "1px solid hsl(198 18% 18%)", borderRadius: 8, color: "hsl(197 13% 90%)" }}
          cursor={{ stroke: "hsl(198 18% 18%)" }}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(168 100% 33%)" strokeWidth={2} fill="url(#fill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Rewrite `dashboard/page.tsx`**

Note: stats use representative placeholder data marked `MOCK` for later wiring; this is a design reference screen (per spec non-goals).

```tsx
import { getTranslations } from "next-intl/server";
import { MessageSquare, Users, CheckCheck, Smartphone } from "lucide-react";
import { requireMember } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { ActivityChart } from "@/components/dashboard/activity-chart";

export default async function DashboardPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();

  // MOCK data — replace with live aggregates when wiring this screen.
  const chart = [
    { label: "Mon", value: 120 }, { label: "Tue", value: 210 }, { label: "Wed", value: 180 },
    { label: "Thu", value: 320 }, { label: "Fri", value: 280 }, { label: "Sat", value: 140 }, { label: "Sun", value: 90 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.welcome", { workspace: workspace.name })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dashboard.statMessages")} value="1,340" delta={{ value: "12%", positive: true }} icon={MessageSquare} />
        <StatCard label={t("dashboard.statContacts")} value="892" delta={{ value: "4%", positive: true }} icon={Users} />
        <StatCard label={t("dashboard.statDelivery")} value="98.2%" icon={CheckCheck} />
        <StatCard label={t("dashboard.statInstances")} value="3" icon={Smartphone} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t("dashboard.activityTitle")}</CardTitle></CardHeader>
          <CardContent><ActivityChart data={chart} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.recentTitle")}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("dashboard.recentEmpty")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/dashboard apps/web/src/app/'[workspaceSlug]'/dashboard/page.tsx apps/web/messages/en-GB.json
git commit -m "feat(web): skinned dashboard reference screen"
```

---

## Task 6: Inbox chat-thread reference screen

**Files:**
- Create: `apps/web/src/components/inbox/chat-thread.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/inbox/page.tsx`
- Modify: `apps/web/messages/en-GB.json`

The existing page already renders `ConversationList` + an empty-chat message. We replace only the empty `<main>` placeholder with a styled empty state, and add a reusable `ChatThread` component the conversation route can adopt. We do not change data fetching.

- [ ] **Step 1: Add inbox copy keys**

In `apps/web/messages/en-GB.json`, ensure the `"inbox"` object contains:

```json
"inbox": {
  "emptyChat": "Select a conversation to start messaging",
  "composerPlaceholder": "Type a message",
  "send": "Send"
}
```
(Keep any existing inbox keys; add the missing ones.)

- [ ] **Step 2: `chat-thread.tsx` (client)**

```tsx
"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ChatMessage = { id: string; body: string; outbound: boolean; time: string };

export function ChatThread({
  contactName, messages, placeholder, sendLabel,
}: {
  contactName: string;
  messages: ChatMessage[];
  placeholder: string;
  sendLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const initials = contactName.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
        <Avatar className="h-9 w-9"><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <span className="font-medium">{contactName}</span>
      </header>

      <div className="flex-1 space-y-2 overflow-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.outbound ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[75%] rounded-lg px-3 py-2 text-sm shadow",
                m.outbound ? "bg-bubble-out text-foreground" : "bg-bubble-in text-foreground"
              )}
            >
              <p>{m.body}</p>
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">{m.time}</span>
            </div>
          </div>
        ))}
      </div>

      <form
        className="flex items-center gap-2 border-t bg-background p-3"
        onSubmit={(e) => { e.preventDefault(); setDraft(""); }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="flex-1" />
        <Button type="submit" size="icon" aria-label={sendLabel}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Restyle the empty state in `inbox/page.tsx`**

Replace only the `<main>` element (keep all imports, data fetching, and `<ConversationList>` untouched):

```tsx
      <main className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
            <span className="text-2xl">💬</span>
          </div>
          <p className="text-sm">{t("inbox.emptyChat")}</p>
        </div>
      </main>
```

Also remove the `gap-0` wrapper's fixed height if it conflicts with the shell; change the outer wrapper to `className="flex h-full"`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/inbox apps/web/src/app/'[workspaceSlug]'/inbox/page.tsx apps/web/messages/en-GB.json
git commit -m "feat(web): skinned inbox empty state + reusable ChatThread"
```

---

## Task 7: Root layout — dark default + Toaster

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Add `dark`/token background and mount Toaster**

Update `layout.tsx` so the `<html>` (or `<body>`) carries the themed background and the toaster is mounted:

```tsx
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { Toaster } from "@/components/ui/toaster";

export const metadata = { title: "Evolution Manager" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

(The token palette in `:root` is already dark; the `dark` class is a harmless explicit marker and keeps the door open for a `.light` toggle later.)

- [ ] **Step 2: Verify full build**

Run: `pnpm --filter @evo/web build`
Expected: build succeeds (no type or import errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): dark-default root layout + toaster mount"
```

---

## Task 8: `components/ui` README (composition notes)

**Files:**
- Create: `apps/web/src/components/ui/README.md`

- [ ] **Step 1: Write the README**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/README.md
git commit -m "docs(web): ui primitives composition notes"
```

---

## Task 9: The design brief deliverable (`docs/design/UI-BRIEF.md`)

**Files:**
- Create: `docs/design/UI-BRIEF.md`

This is the document the user hands to a design-Claude. It must be self-contained (no TBDs). Write it with these exact sections and content.

- [ ] **Step 1: Write `docs/design/UI-BRIEF.md`**

Include, fully written out (not placeholders):

1. **Product summary** — "Evolution Manager is a multi-tenant manager UI for Evolution API (WhatsApp). It lets agencies and schools run WhatsApp at scale: connect numbers (instances), manage contacts, send templated broadcasts, run drip automations, warm up numbers, handle a shared team inbox, and view analytics. Built with Next.js 15 (App Router, RSC), Prisma/Postgres, Auth.js, BullMQ, Socket.IO, next-intl (en-GB)." Primary users: workspace Owners/Admins (setup, billing, members), Agents (inbox, contacts). Tone: professional, calm, trustworthy — they're sending real messages to real customers.

2. **Visual direction** — WhatsApp-native, dark-first. Emulate WhatsApp Web/Desktop dark for messaging surfaces (bubbles, conversation list, composer), and apply Linear/Resend-grade polish to dashboards/tables/forms (tight spacing, clear hierarchy, restrained motion). Do's: high contrast text, green used sparingly as accent + primary actions, generous breathing room, consistent 8px rhythm. Don'ts: no rainbow colors, no heavy drop shadows, no busy gradients, no emoji-as-UI except where intentionally WhatsApp-ish.

3. **Design tokens** — reproduce the exact palette/radii from `apps/web/src/app/globals.css` (base `#0B141A`, panel `#111B21`, hover `#202C33`, primary `#00A884`, sent bubble `#005C4B`, text `#E9EDEF`/`#8696A0`, radius `0.625rem`). State that generated designs MUST use these tokens. Reference the Tailwind token classes from `src/components/ui/README.md`.

4. **Screen inventory** — list every route with purpose / key data / primary actions / states. Cover, at minimum:
   - `(auth)`: sign-in, sign-up, accept-invite/[token]
   - `onboarding`: create workspace
   - `[workspace]/dashboard` (DONE — reference)
   - `[workspace]/inbox` (+ `/[conversationId]`) (DONE — reference)
   - `[workspace]/contacts` (+ `/import`)
   - `[workspace]/templates`
   - `[workspace]/broadcasts` (+ `/new`, `/[id]`)
   - `[workspace]/automation` (+ `/drip`)
   - `[workspace]/warmer` (+ `/new`, `/[id]`)
   - `[workspace]/analytics`
   - `[workspace]/instances` (+ `/new`, `/[id]`) — includes QR-pairing flow
   - `[workspace]/groups`
   - `[workspace]/settings/{members,plan,quick-replies,api-keys,integrations,audit,webhooks}`
   - `admin/{plans,health,workspaces,users}` (platform admin)
   For each, note empty / loading / error states.

5. **Component checklist** — nav shell (done), cards, stat tiles, data tables (sortable, paginated, row actions), forms (labels, validation, helper text), chat thread (done), charts (recharts, themed), modals/dialogs, dropdown menus, toasts, badges/status pills (connected/disconnected/warming), avatars, skeletons, empty states, QR display.

6. **Stack constraints** — Next 15 App Router + RSC (server-first; `"use client"` only for interactivity), Tailwind + the token system, shadcn/ui primitives in `src/components/ui`, lucide-react icons, recharts for charts, next-intl for all copy (no hard-coded strings — add keys to `apps/web/messages/en-GB.json`). Output must be implementable React/TSX that imports the existing primitives, not standalone HTML/CSS.

7. **How to use this brief** — "Paste this file plus a screenshot of the dashboard/inbox reference screens. Ask for one screen at a time. Require the output to (a) use only the tokens above, (b) import from `@/components/ui/*`, (c) match the spacing/hierarchy of the reference screens, (d) include empty/loading/error states."

- [ ] **Step 2: Self-check the brief for placeholders**

Run: `grep -ni "TBD\|TODO\|FIXME\|lorem" docs/design/UI-BRIEF.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/design/UI-BRIEF.md
git commit -m "docs(design): WhatsApp-native UI brief for design handoff"
```

---

## Task 10: Final verification

- [ ] **Step 1: Typecheck + build**

Run: `pnpm --filter @evo/web exec tsc --noEmit && pnpm --filter @evo/web build`
Expected: both succeed.

- [ ] **Step 2: Existing e2e unaffected (no logic changed)**

Run: `pnpm --filter @evo/web test:e2e`
Expected: the existing happy-path passes (or, if the environment can't run Playwright here, confirm no routing/data files were modified — only presentation).

- [ ] **Step 3: Manual visual check**

Start dev (`pnpm dev`), open `/<workspace>/dashboard` and `/<workspace>/inbox`. Confirm: dark WhatsApp surfaces, green accents, sidebar active-state highlight, stat cards, themed chart, chat empty state.

- [ ] **Step 4: Final commit (if any pending docs)**

```bash
git status
```
Expected: clean tree.

---

## Self-Review notes (author)

- **Spec coverage:** Part A brief → Task 9. Part B tokens → Task 2; shadcn foundation → Tasks 1+3; app shell → Task 4; dashboard reference → Task 5; inbox reference → Task 6; ui README → Task 8; dark root layout → Task 7. Success criteria (build passes, screens render, brief complete) → Task 10. All spec items mapped.
- **No app-logic changes:** inbox data fetching and `requireMember` calls preserved; only presentation touched.
- **Type consistency:** `cn` from `@/lib/utils` used everywhere; token color names (`bubble-out`, `bubble-in`, `sidebar`) defined in Task 2 and consumed in Tasks 4/6; `StatCard`/`ActivityChart`/`ChatThread` props match their call sites.
