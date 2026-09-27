const fs = require("node:fs");
const path = require("node:path");

function createCredentialVault({ filePath, safeStorage }) {
  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating-system credential encryption is unavailable; Mora refused to store credentials.");
    }
  }

  return {
    load() {
      if (!fs.existsSync(filePath)) return { providers: {}, llm: "", tts: { apiKey: "", groupId: "" } };
      requireEncryption();
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
    },
    save(value) {
      requireEncryption();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      const temporary = filePath + ".tmp";
      fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
      fs.renameSync(temporary, filePath);
      try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs are managed by the OS. */ }
    },
    clear() {
      try { fs.unlinkSync(filePath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    },
  };
}

module.exports = { createCredentialVault };
