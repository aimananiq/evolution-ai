// Small brand tile used in the sidebar / mobile drawer header. WhatsApp-green
// rounded square with a chat-bubble "W". Swap the SVG for a real logo later.
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={"flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground " + (className ?? "")}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 20l1.4-4.1A8.5 8.5 0 1 1 21 11.5Z" />
        <path d="m8 10 1.5 4L12 10l2.5 4L16 10" />
      </svg>
    </div>
  );
}
