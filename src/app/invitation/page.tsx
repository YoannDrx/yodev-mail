import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { InvitationPanel } from "@/components/auth/invitation-panel";

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id || id.length < 20) notFound();
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href="/"><BrandMark className="text-xl" /></Link>
        <InvitationPanel invitationId={id} />
      </div>
    </main>
  );
}
