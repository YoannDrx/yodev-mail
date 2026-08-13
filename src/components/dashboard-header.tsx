import { Bell, Search } from "lucide-react";
import { AccountMenu } from "@/components/auth/account-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DashboardHeader() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white/90 px-5 backdrop-blur">
      <div className="relative hidden w-72 md:block">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="h-9 pl-9" placeholder="Rechercher…" />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Button aria-label="Notifications" size="icon" variant="ghost"><Bell /></Button>
        <AccountMenu />
      </div>
    </header>
  );
}
