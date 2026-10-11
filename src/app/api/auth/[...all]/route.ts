import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { isDisabledAuthPath } from "@/lib/auth-policy";
import { env } from "@/lib/env";

const handler = async (request: Request) => {
  const { pathname } = new URL(request.url);
  if (isDisabledAuthPath(pathname, { emailPasswordEnabled: env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED === "true" })) {
    return new Response("Not Found", { status: 404 });
  }
  return getAuth().handler(request);
};

export const { DELETE, GET, PATCH, POST, PUT } = toNextJsHandler(handler);
