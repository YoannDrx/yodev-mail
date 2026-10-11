import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { getDefaultAutoSelectFamily } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postWebhookSafely } from "./safe-http";
import { isPrivateAddress } from "./validate-url";

// No mock of node:https or node:dns here: this drives a real `https.request`
// through the production lookup against a real local TLS server. The key pair
// is generated for this run only and never written to the repository.
function generateCertificate() {
  const directory = mkdtempSync(path.join(tmpdir(), "yodev-webhook-tls-"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost",
      "-keyout", path.join(directory, "key.pem"),
      "-out", path.join(directory, "cert.pem"),
    ], { stdio: "ignore" });
    return {
      cert: readFileSync(path.join(directory, "cert.pem"), "utf8"),
      key: readFileSync(path.join(directory, "key.pem"), "utf8"),
    };
  } catch {
    return null;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const certificate = generateCertificate();
if (!certificate) {
  console.warn("Skipping the real TLS webhook test: the openssl CLI is not available to generate a throwaway certificate.");
}

type Received = { body: string; headers: Record<string, string | string[] | undefined> };

function listen(server: Server, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

describe.skipIf(!certificate)("webhook delivery over a real TLS socket", () => {
  let server: Server;
  let port: number;
  const received: Received[] = [];
  const loopbackOnly = (address: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);

  beforeAll(async () => {
    server = createServer({ cert: certificate!.cert, key: certificate!.key }, (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ body: Buffer.concat(chunks).toString("utf8"), headers: request.headers });
        response.writeHead(204).end();
      });
    });
    // Listen on both stacks when IPv6 exists, as `localhost` may resolve to ::1 first.
    await listen(server, "::").catch(() => listen(server, "127.0.0.1"));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers through the pinned lookup when Node asks for every address", async () => {
    // Node 20+ enables happy eyeballs by default and then calls the agent's
    // lookup with `{ all: true }`: the case that broke every delivery.
    expect(getDefaultAutoSelectFamily()).toBe(true);
    const body = JSON.stringify({ id: "evt", type: "email.delivered" });
    const status = await postWebhookSafely({
      url: `https://localhost:${port}/hooks`,
      body,
      headers: { "content-type": "application/json", "x-yodev-mail-signature": "signature" },
      timeoutMs: 5_000,
    }, { isAllowedAddress: loopbackOnly, ca: certificate!.cert });
    expect(status).toBe(204);
    expect(received.at(-1)).toMatchObject({ body, headers: { "x-yodev-mail-signature": "signature" } });
  });

  it("refuses the same loopback server under the production address policy", async () => {
    const before = received.length;
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    await expect(postWebhookSafely({
      url: `https://localhost:${port}/hooks`,
      body: "{}",
      headers: {},
      timeoutMs: 5_000,
    })).rejects.toThrow("Webhook DNS resolution was rejected.");
    expect(received).toHaveLength(before);
  });
});
