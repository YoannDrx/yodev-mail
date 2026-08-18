import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  agentDestroy: vi.fn(),
  agentOptions: undefined as
    | { lookup: (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void }
    | undefined,
  dnsLookup: vi.fn(),
  httpsRequest: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: dependencies.dnsLookup }));
vi.mock("node:https", () => ({
  Agent: class {
    constructor(options: typeof dependencies.agentOptions) {
      dependencies.agentOptions = options;
    }

    destroy() {
      dependencies.agentDestroy();
    }
  },
  request: dependencies.httpsRequest,
}));

import { postWebhookSafely, selectPublicLookupAddress } from "./safe-http";

afterEach(() => {
  dependencies.agentDestroy.mockReset();
  dependencies.agentOptions = undefined;
  dependencies.dnsLookup.mockReset();
  dependencies.httpsRequest.mockReset();
});

describe("webhook socket-time DNS selection", () => {
  it("accepts a set containing only public addresses", () => {
    expect(
      selectPublicLookupAddress([
        { address: "8.8.8.8", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ]),
    ).toEqual({ address: "8.8.8.8", family: 4 });
  });

  it("rejects a mixed public/private answer to prevent rebinding", () => {
    expect(() =>
      selectPublicLookupAddress([
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).toThrow(/rejected/);
  });

  it("rejects IPv4-mapped private IPv6 addresses", () => {
    expect(() =>
      selectPublicLookupAddress([{ address: "::ffff:169.254.169.254", family: 6 }]),
    ).toThrow(/rejected/);
  });

  it("posts through the pinned DNS agent and always destroys it", async () => {
    dependencies.dnsLookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    dependencies.httpsRequest.mockImplementation((_url, _options, callback) => {
      const response = new EventEmitter() as EventEmitter & {
        resume: () => void;
        statusCode: number;
      };
      response.resume = vi.fn();
      response.statusCode = 204;
      queueMicrotask(() => {
        callback(response);
        response.emit("end");
      });
      const outgoing = new EventEmitter() as EventEmitter & { end: (body: string) => void };
      outgoing.end = vi.fn();
      return outgoing;
    });

    await expect(postWebhookSafely({
      url: "https://webhook.example.test/events",
      body: "{}",
      headers: { "content-type": "application/json" },
      timeoutMs: 1_000,
    })).resolves.toBe(204);

    const lookup = dependencies.agentOptions?.lookup;
    expect(lookup).toBeDefined();
    const callback = vi.fn();
    lookup?.("webhook.example.test", {}, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4));
    expect(dependencies.agentDestroy).toHaveBeenCalledTimes(1);
  });

  it("forwards DNS and request errors while destroying the agent", async () => {
    dependencies.httpsRequest.mockImplementation(() => {
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
      outgoing.end = () => queueMicrotask(() => outgoing.emit("error", new Error("socket failed")));
      return outgoing;
    });

    await expect(postWebhookSafely({
      url: "https://webhook.example.test/events",
      body: "{}",
      headers: {},
      timeoutMs: 1_000,
    })).rejects.toThrow("socket failed");
    expect(dependencies.agentDestroy).toHaveBeenCalledTimes(1);

    dependencies.dnsLookup.mockRejectedValue(new Error("dns failed"));
    const callback = vi.fn();
    dependencies.agentOptions?.lookup("webhook.example.test", {}, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: "dns failed" }),
      "",
      4,
    ));
  });
});
