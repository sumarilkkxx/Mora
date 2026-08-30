import { describe, expect, it } from "vitest";
import { exportDurationSeconds } from "@/lib/export-metadata";

describe("exportDurationSeconds", () => {
  it("uses the measured composition duration instead of the script plan", () => {
    expect(exportDurationSeconds(15069, 30)).toBe(15);
  });

  it("falls back to the script duration before a composition exists", () => {
    expect(exportDurationSeconds(null, 30)).toBe(30);
  });

  it("returns zero when neither duration is usable", () => {
    expect(exportDurationSeconds(0, undefined)).toBe(0);
  });
});
