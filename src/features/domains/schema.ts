/**
 * Domain name accepted by the console, shared by the server schema and the
 * input `pattern` attribute (which is implicitly anchored by the browser).
 */
// `\-` keeps the class valid under the `v` flag browsers use for `pattern`.
export const domainPattern = "(?!-)(?:[a-zA-Z0-9\\-]+\\.)+[a-zA-Z]{2,63}";
