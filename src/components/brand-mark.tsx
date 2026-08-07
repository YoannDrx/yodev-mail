import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 36 36" aria-hidden="true" className="size-8 shrink-0">
        <defs><linearGradient id="yodev-mail-gradient" x1="4" y1="3" x2="32" y2="34"><stop stopColor="#315EFB"/><stop offset="1" stopColor="#19A58F"/></linearGradient></defs>
        <rect width="36" height="36" rx="11" fill="url(#yodev-mail-gradient)"/>
        <path d="M8.5 12.2h19v13.6h-19z" fill="none" stroke="white" strokeWidth="1.7"/>
        <path d="m9.4 13.2 8.6 6.6 8.6-6.6" fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7"/>
        <path d="M18 6.8v2.1M25.9 8.8l-1.5 1.5M10.1 8.8l1.5 1.5" stroke="white" strokeLinecap="round" strokeWidth="1.7"/>
      </svg>
      <span className="inline-flex items-baseline gap-1.5"><span className="text-primary">Mail</span><span className="font-mono text-[0.62em] uppercase tracking-[0.16em] text-muted-foreground">by Yodev</span></span>
    </span>
  );
}
