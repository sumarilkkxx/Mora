/** Credentials are sent only to the configured server, never to a caller-supplied host. */
export function internalApiHeaders(origin: string): Record<string, string> {
  const token = process.env.MORA_API_TOKEN;
  if (token && (!process.env.MORA_SERVER_ORIGIN || new URL(origin).origin !== new URL(process.env.MORA_SERVER_ORIGIN).origin)) {
    throw new Error("Internal API origin is not configured or trusted");
  }
  return { "Content-Type": "application/json", ...(token ? { "x-mora-token": token } : {}) };
}

/** Resolve the only origin that server-side pipeline self-requests may target. */
export function trustedInternalApiOrigin(requestUrl: string | URL): string {
  const configured = process.env.MORA_SERVER_ORIGIN;
  const requested = new URL(configured || requestUrl);
  if (requested.protocol !== "http:" && requested.protocol !== "https:") {
    throw new Error("Internal API origin must use HTTP or HTTPS");
  }
  if (configured) return requested.origin;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(requested.hostname)) {
    throw new Error("MORA_SERVER_ORIGIN is required for non-loopback pipeline requests");
  }
  return requested.origin;
}
