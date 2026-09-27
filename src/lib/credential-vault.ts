export interface CredentialSnapshot {
  providers: Record<string, string>;
  llm: string;
  tts: { apiKey: string; groupId: string };
}

export interface CredentialVault {
  load(): Promise<CredentialSnapshot>;
  save(credentials: CredentialSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export const EMPTY_CREDENTIALS: CredentialSnapshot = {
  providers: {},
  llm: "",
  tts: { apiKey: "", groupId: "" },
};

type SettingsLike = {
  providers?: Record<string, { apiKey?: string }>;
  llm?: { apiKey?: string };
  tts?: { apiKey?: string; groupId?: string };
};

function normalized(value: Partial<CredentialSnapshot> | null | undefined): CredentialSnapshot {
  return {
    providers: Object.fromEntries(Object.entries(value?.providers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)),
    llm: typeof value?.llm === "string" ? value.llm : "",
    tts: {
      apiKey: typeof value?.tts?.apiKey === "string" ? value.tts.apiKey : "",
      groupId: typeof value?.tts?.groupId === "string" ? value.tts.groupId : "",
    },
  };
}

/** The only seam allowed to turn UI settings into disk-safe ordinary settings. */
export function splitCredentials<T extends object>(input: T): { settings: T; credentials: CredentialSnapshot } {
  const source = input as T & SettingsLike;
  const providers = Object.fromEntries(
    Object.entries(source.providers ?? {}).map(([name, setting]) => [name, { ...setting, apiKey: "" }])
  );
  const credentials = normalized({
    providers: Object.fromEntries(Object.entries(source.providers ?? {}).map(([name, setting]) => [name, setting.apiKey ?? ""])),
    llm: source.llm?.apiKey ?? "",
    tts: { apiKey: source.tts?.apiKey ?? "", groupId: source.tts?.groupId ?? "" },
  });
  const settings = {
    ...source,
    ...(source.providers ? { providers } : {}),
    ...(source.llm ? { llm: { ...source.llm, apiKey: "" } } : {}),
    ...(source.tts ? { tts: { ...source.tts, apiKey: "", groupId: undefined } } : {}),
  } as T;
  return { settings, credentials };
}

export function mergeCredentials<T extends object>(settings: T, value: CredentialSnapshot): T {
  const source = settings as T & SettingsLike;
  const credentials = normalized(value);
  const providers = Object.fromEntries(
    Object.entries(source.providers ?? {}).map(([name, setting]) => [name, { ...setting, apiKey: credentials.providers[name] ?? "" }])
  );
  const tts = source.tts
    ? { ...source.tts, apiKey: credentials.tts.apiKey, ...(credentials.tts.groupId ? { groupId: credentials.tts.groupId } : {}) }
    : undefined;
  return {
    ...source,
    ...(source.providers ? { providers } : {}),
    ...(source.llm ? { llm: { ...source.llm, apiKey: credentials.llm } } : {}),
    ...(tts ? { tts } : {}),
  } as T;
}

const WEB_SESSION_KEY = "mora-credentials-session-v1";

export function createWebCredentialVault(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): CredentialVault {
  return {
    async load() {
      const raw = storage.getItem(WEB_SESSION_KEY);
      if (!raw) return normalized(null);
      try { return normalized(JSON.parse(raw) as Partial<CredentialSnapshot>); }
      catch { return normalized(null); }
    },
    async save(credentials) {
      storage.setItem(WEB_SESSION_KEY, JSON.stringify(normalized(credentials)));
    },
    async clear() {
      storage.removeItem(WEB_SESSION_KEY);
    },
  };
}

interface DesktopCredentialBridge {
  load(): Promise<CredentialSnapshot>;
  save(credentials: CredentialSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export function createRendererCredentialVault(browserWindow: Window & { moraCredentials?: DesktopCredentialBridge } = window): CredentialVault {
  const desktop = browserWindow.moraCredentials;
  if (desktop) return desktop;
  return createWebCredentialVault(browserWindow.sessionStorage);
}

declare global {
  interface Window {
    moraCredentials?: DesktopCredentialBridge;
  }
}
