import { describe, expect, test } from "vitest";
import { isPermissionDenial, probeNames, safeError } from "./certify-ses-test.mjs";

describe("SES test probe guards", () => {
  test("uses only isolated synthetic names and rejects arbitrary input", () => {
    expect(probeNames("dev", "20260910a").domain).toBe("dev.ses-probe-20260910a.yodev.fr");
    for (const run of ["", "production", "20260910a.yodev.fr", "../20260910a"]) expect(() => probeNames("prod", run)).toThrow();
  });
  test("does not treat validation, missing identity or throttling as an IAM denial", () => {
    expect(isPermissionDenial({ name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } })).toBe(true);
    for (const name of ["NotFoundException", "MessageRejected", "TooManyRequestsException", "BadRequestException", "UnknownError"]) {
      expect(isPermissionDenial({ name, $metadata: { httpStatusCode: 403 } })).toBe(false);
    }
  });
  test("never reports error messages or credentials", () => {
    expect(safeError({ name: "BadRequestException", message: "private payload", Credentials: "private", $metadata: { httpStatusCode: 400, requestId: "opaque" } })).toEqual({ code: "BadRequestException", status: 400, requestId: "opaque" });
  });
});
