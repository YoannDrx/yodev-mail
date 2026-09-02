import { NextResponse } from "next/server";

const DATABASE_UNAVAILABLE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53000",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

export function causalErrorCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    const candidate = current as { cause?: unknown; code?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

function safeFailure(error: unknown) {
  const code = causalErrorCode(error);
  const databaseUnavailable = Boolean(code && DATABASE_UNAVAILABLE_CODES.has(code));
  return {
    logCode: databaseUnavailable ? "database_unavailable" : "internal_error",
    publicCode: databaseUnavailable ? "service_unavailable" : "internal_error",
    status: databaseUnavailable ? 503 : 500,
  };
}

type RouteHandler<Arguments extends unknown[]> = (
  request: Request,
  ...arguments_: Arguments
) => Promise<Response>;

export function withSafeRouteErrors<Arguments extends unknown[]>(
  handler: RouteHandler<Arguments>,
): RouteHandler<Arguments> {
  return async (request, ...arguments_) => {
    try {
      return await handler(request, ...arguments_);
    } catch (error) {
      const requestId = crypto.randomUUID();
      const failure = safeFailure(error);
      console.error(JSON.stringify({
        level: "error",
        message: "api.request_failed",
        code: failure.logCode,
        method: request.method,
        pathname: new URL(request.url).pathname,
        requestId,
      }));
      return NextResponse.json(
        { error: { code: failure.publicCode, requestId } },
        { status: failure.status, headers: { "x-request-id": requestId } },
      );
    }
  };
}
