import { NextRequest, NextResponse } from "next/server";

const CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

function allowedLocalOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
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
  const origin = allowedLocalOrigin(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return origin
      ? addCorsHeaders(new NextResponse(null, { status: 204 }), origin, request)
      : new NextResponse(null, { status: 204 });
  }
  const response = NextResponse.next();
  return origin ? addCorsHeaders(response, origin, request) : response;
}

export const config = { matcher: "/api/:path*" };
