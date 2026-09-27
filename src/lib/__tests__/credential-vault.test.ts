import { describe, expect, it } from "vitest";
import {
  createWebCredentialVault,
  mergeCredentials,
  splitCredentials,
  type CredentialSnapshot,
} from "@/lib/credential-vault";

const credentials: CredentialSnapshot = {
  providers: { openrouter: "provider-secret", "atlas-cloud": "atlas-secret" },
  llm: "llm-secret",
  tts: { apiKey: "tts-secret", groupId: "group-secret" },
};

describe("credential persistence boundary", () => {
  it("removes every credential before settings enter SQLite or JSON persistence", () => {
    const input = {
      providers: {
        openrouter: { enabled: true, apiKey: "provider-secret", baseUrl: "https://openrouter.ai/api/v1" },
        "atlas-cloud": { enabled: true, apiKey: "atlas-secret" },
      },
      llm: { provider: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "llm-secret", model: "m" },
      tts: { enabled: true, provider: "openai", baseUrl: "https://tts.example", apiKey: "tts-secret", groupId: "group-secret", model: "tts", voice: "v" },
      locale: "zh-CN",
    };

    const split = splitCredentials(input);
    expect(split.credentials).toEqual(credentials);
    expect(JSON.stringify(split.settings)).not.toMatch(/provider-secret|atlas-secret|llm-secret|tts-secret|group-secret/);
    expect(split.settings.providers.openrouter.apiKey).toBe("");
    expect(split.settings.llm.apiKey).toBe("");
    expect(split.settings.tts.apiKey).toBe("");
    expect(split.settings.tts.groupId).toBeUndefined();
    expect(mergeCredentials(split.settings, credentials)).toEqual(input);
  });

  it("keeps web-development credentials in session storage only", async () => {
    const session = new Map<string, string>();
    const local = new Map<string, string>();
    const vault = createWebCredentialVault({
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key),
    });

    await vault.save(credentials);
    expect(await vault.load()).toEqual(credentials);
    expect([...local.values()]).toEqual([]);
    expect(session.size).toBe(1);
    await vault.clear();
    expect(await vault.load()).toEqual({ providers: {}, llm: "", tts: { apiKey: "", groupId: "" } });
  });
});
