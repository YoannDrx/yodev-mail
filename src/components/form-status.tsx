import { cn } from "@/lib/utils";

// Always rendered so screen readers announce the message when it appears
// (a live region inserted together with its text is often not announced).
export function FormStatus({
  message,
  ok,
  className,
}: {
  message: string;
  ok: boolean;
  className?: string;
}) {
  return (
    <p
      aria-live={ok ? "polite" : "assertive"}
      className={cn(
        "text-sm empty:hidden",
        ok ? "text-[var(--y-success)]" : "text-destructive",
        className,
      )}
      role={ok ? "status" : "alert"}
    >
      {message}
    </p>
  );
}

export function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p className="text-xs text-destructive" id={id}>
      {errors.join(" ")}
    </p>
  );
}
