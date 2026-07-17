import { MarketingFooter } from "@/components/marketing-footer";
import { MarketingHeader } from "@/components/marketing-header";

export function PageShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) {
  return <><MarketingHeader/><main className="min-h-[70vh]"><header className="border-b px-5 py-20 text-center"><p className="text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p><h1 className="mx-auto mt-4 max-w-4xl text-balance text-5xl font-semibold tracking-tight">{title}</h1><p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">{intro}</p></header><div className="mx-auto max-w-6xl px-5 py-16">{children}</div></main><MarketingFooter/></>;
}
