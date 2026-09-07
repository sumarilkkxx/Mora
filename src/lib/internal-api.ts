/** Credentials are sent only to the configured server, never to a caller-supplied host. */
export function internalApiHeaders(origin: string): Record<string, string> {
  const token = process.env.MORA_API_TOKEN;
  if (token && (!process.env.MORA_SERVER_ORIGIN || new URL(origin).origin !== new URL(process.env.MORA_SERVER_ORIGIN).origin)) {
    throw new Error("Internal API origin is not configured or trusted");
  }
  return { "Content-Type": "application/json", ...(token ? { "x-mora-token": token } : {}) };
}
