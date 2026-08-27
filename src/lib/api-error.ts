/**
 * Locale-aware API error helper.
 *
 * API routes historically returned hardcoded Chinese error strings, so overseas users (English
 * browsers hitting TikTok/Reels/Shorts flows) saw Chinese error text they couldn't read. This helper
 * keeps the Chinese message byte-for-byte for domestic users (the default) and returns an English
 * message only when the request's `Accept-Language` clearly prefers English.
 *
 * Design: bilingual strings are passed INLINE at each call site (no central key registry) — this keeps
 * the zh text provably unchanged, avoids key collisions, and makes each route self-contained.
 */
import { NextResponse } from "next/server";

export type ApiLocale = "zh" | "en";

/** Minimal shape we need — works for NextRequest and the standard Request. */
interface HasHeaders {
  headers: { get(name: string): string | null };
}

/**
 * Pick the response locale from the request's Accept-Language header.
 * Domestic-first: default to Chinese; only switch to English when the top language tag starts with "en".
 * Pure-ish (reads only the header), unit-testable.
 */
export function pickLocale(req: HasHeaders): ApiLocale {
  const header = req.headers.get("accept-language") || "";
  const first = header.split(",")[0]?.trim().toLowerCase() || "";
  return first.startsWith("en") ? "en" : "zh";
}

/** Localized error string for the request (zh by default, en for English clients). */
export function errText(req: HasHeaders, zh: string, en: string): string {
  return pickLocale(req) === "en" ? en : zh;
}

/**
 * Build a localized error JSON response. Use for the common `{ error }`-only case.
 * For responses that carry extra fields (e.g. `{ error, projectId }`), use `errText` inline instead.
 */
export function apiError(req: HasHeaders, zh: string, en: string, status = 400): NextResponse {
  return NextResponse.json({ error: errText(req, zh, en) }, { status });
}
