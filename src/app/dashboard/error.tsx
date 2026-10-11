"use client"; // Error boundaries must be Client Components.

import { ErrorFallback } from "@/components/error-fallback";

/** Keeps the console navigation (layout) around a failed page. */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback digest={error.digest} home="/dashboard" retry={retry} />;
}
