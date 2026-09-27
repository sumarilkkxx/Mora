import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCredentialVault } = require("../../../electron/credential-vault.cjs") as {
  createCredentialVault: (options: {
    filePath: string;
    safeStorage: { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };
  }) => { save(value: unknown): void; load(): unknown; clear(): void };
};

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("desktop credential vault", () => {
  it("persists only encrypted bytes and decrypts on load", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mora-credentials-"));
    directories.push(directory);
    const filePath = join(directory, "credentials.bin");
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`),
      decryptString: (value: Buffer) => Buffer.from(value.toString().slice("encrypted:".length), "base64").toString(),
    };
    const vault = createCredentialVault({ filePath, safeStorage });

    vault.save({ llm: "desktop-secret" });
    expect((await readFile(filePath, "utf8"))).not.toContain("desktop-secret");
    expect(vault.load()).toEqual({ llm: "desktop-secret" });
  });

  it("rejects writes when operating-system encryption is unavailable", () => {
    const vault = createCredentialVault({
      filePath: "/unused/credentials.bin",
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" },
    });
    expect(() => vault.save({ llm: "secret" })).toThrow(/encryption.*unavailable/i);
  });
});
