import type { Metadata } from "next";
import { DM_Sans, Fira_Code, Plus_Jakarta_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isClerkConfigured } from "@/lib/env";
import "./globals.css";

const bodyFont = DM_Sans({
  variable: "--font-yodev-body",
  subsets: ["latin"],
});

const displayFont = Plus_Jakarta_Sans({
  variable: "--font-yodev-display",
  subsets: ["latin"],
});

const monoFont = Fira_Code({
  variable: "--font-yodev-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: "Mail by Yodev — Tous vos emails. Zéro angle mort.", template: "%s — Mail by Yodev" },
  description: "La plateforme française d'email transactionnel et marketing, propulsée par Amazon SES.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {isClerkConfigured() ? (
          <ClerkProvider><TooltipProvider>{children}</TooltipProvider></ClerkProvider>
        ) : (
          <TooltipProvider>{children}</TooltipProvider>
        )}
      </body>
    </html>
  );
}
