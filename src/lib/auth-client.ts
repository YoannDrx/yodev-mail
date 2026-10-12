"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

// The admin plugin's HTTP endpoints are closed (see auth-policy.ts), so the
// browser client does not expose them either.
export const authClient = createAuthClient({
  plugins: [organizationClient(), passkeyClient()],
});
