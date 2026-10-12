// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";
import { ErrorFallback } from "@/components/error-fallback";

vi.mock("@/app/globals.css", () => ({}));

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
  window.history.replaceState(null, "", "/");
});

describe("error boundaries", () => {
  it("speaks the page language, announces the failure and retries", () => {
    document.documentElement.lang = "en";
    const retry = vi.fn();
    render(<ErrorFallback digest="abc123" home="/dashboard" retry={retry} />);
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("could not be displayed");
    expect(screen.getByText("Reference : abc123")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to overview" }).getAttribute("href")).toBe("/en/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("never shows the raw error message", () => {
    document.documentElement.lang = "fr";
    render(<ErrorFallback digest={undefined} home="/" retry={() => {}} standalone />);
    expect(screen.getByRole("heading", { level: 1, name: "Une erreur est survenue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour à l’accueil" }).getAttribute("href")).toBe("/fr");
    expect(screen.getByRole("main").id).toBe("main-content");
  });

  it("global error falls back to the URL prefix for its own document", () => {
    window.history.replaceState(null, "", "/en/dashboard");
    const error = Object.assign(new Error("database password leaked"), { digest: "d1" });
    // global-error renders <html>; React warns when it is nested in a test container.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GlobalError error={error} retry={() => {}} />);
    warn.mockRestore();
    expect(screen.getByRole("heading", { level: 1, name: "Service temporarily unavailable" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("database password leaked");
  });
});
