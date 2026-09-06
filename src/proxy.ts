import { NextRequest, NextResponse } from "next/server";

const CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

function allowedOrigin(origin: string | null, request: NextRequest): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Next may normalize nextUrl to its internal hostname (e.g. localhost).
    const serverOrigin = process.env.MORA_SERVER_ORIGIN ?? `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
    return url.origin === new URL(serverOrigin).origin || (process.env.MORA_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).includes(url.origin)
      ? origin
      : null;
  } catch {
    return null;
  }
}

function addCorsHeaders(response: NextResponse, origin: string, request: NextRequest): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", CORS_METHODS);
  response.headers.set(
    "Access-Control-Allow-Headers",
    request.headers.get("access-control-request-headers") || "content-type, authorization",
  );
  response.headers.append("Vary", "Origin");
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const suppliedOrigin = request.headers.get("origin");
  const origin = allowedOrigin(suppliedOrigin, request);
  if ((suppliedOrigin && !origin) || (!suppliedOrigin && request.headers.get("sec-fetch-site") === "cross-site")) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return origin
      ? addCorsHeaders(new NextResponse(null, { status: 204 }), origin, request)
      : new NextResponse(null, { status: 204 });
  }
  if (process.env.MORA_API_TOKEN && request.headers.get("x-mora-token") !== process.env.MORA_API_TOKEN) {
    return NextResponse.json({ error: "API token required" }, { status: 401 });
  }
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json" && type !== "multipart/form-data") {
      return NextResponse.json({ error: "Expected JSON or multipart body" }, { status: 415 });
    }
  }
  const response = NextResponse.next();
  return origin ? addCorsHeaders(response, origin, request) : response;
}

export const config = { matcher: "/api/:path*" };
