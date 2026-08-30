/**
 * stripThinkBlocks — reasoning-trace removal ahead of JSON parsing.
 * The three states that matter: closed block(s), unclosed block (truncated output), no block.
 */
import { describe, it, expect } from "vitest";
import { stripThinkBlocks } from "@/lib/llm-clean";

describe("stripThinkBlocks", () => {
  it("removes a closed <think> block and keeps the JSON after it", () => {
    const text = '<think>\nLet me plan: {"draft": [1,2]} …\n</think>\n{"title":"ok"}';
    expect(stripThinkBlocks(text)).toBe('{"title":"ok"}');
  });

  it("removes multiple closed blocks and tag variants", () => {
    const text = '<reasoning>first</reasoning>{"a":1}<thinking attr="x">second</thinking>';
    expect(stripThinkBlocks(text)).toBe('{"a":1}');
  });

  it("removes an unclosed block (truncated mid-thought) up to the end", () => {
    const text = 'prefix {"kept":true}\n<think>never closed, contains {braces} and ```json fences';
    expect(stripThinkBlocks(text)).toBe('prefix {"kept":true}');
  });

  it("returns the original text when stripping would leave nothing", () => {
    const text = '<think>the model wrote everything inside, {"json":"here"}';
    expect(stripThinkBlocks(text)).toBe(text);
  });

  it("leaves text without think tags untouched (including fenced JSON)", () => {
    const text = '```json\n{"a":1}\n```';
    expect(stripThinkBlocks(text)).toBe(text);
  });

  it("does not eat unrelated tags", () => {
    const text = '{"html":"<thead><tr></tr></thead>"}';
    expect(stripThinkBlocks(text)).toBe(text);
  });
});
