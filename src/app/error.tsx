"use client"; // Error boundaries must be Client Components.

import { ErrorFallback } from "@/components/error-fallback";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback digest={error.digest} home="/" retry={retry} standalone />;
}
