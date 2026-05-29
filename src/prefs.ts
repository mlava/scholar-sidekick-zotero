// zotero-plugin/src/prefs.ts
//
// Thin wrapper over Zotero.Prefs for plugin settings. Anonymous-first auth:
// the api key is optional. When absent, requests go out without an auth
// header and hit the anonymous (rate-limited) tier.

declare const Zotero: {
  Prefs: {
    get: (name: string, global?: boolean) => string | number | boolean | undefined;
    set: (name: string, value: string | number | boolean, global?: boolean) => void;
    clear: (name: string, global?: boolean) => void;
  };
};

const PREFIX = "extensions.scholar-sidekick";

export type PrefKey = "apiKey" | "baseUrl";

const DEFAULTS: Record<PrefKey, string> = {
  apiKey: "",
  baseUrl: "https://scholar-sidekick.com",
};

export function getPref(key: PrefKey): string {
  const raw = Zotero.Prefs.get(`${PREFIX}.${key}`, true);
  if (typeof raw === "string" && raw.length > 0) return raw;
  return DEFAULTS[key];
}

export function setPref(key: PrefKey, value: string): void {
  Zotero.Prefs.set(`${PREFIX}.${key}`, value, true);
}

export function clearPref(key: PrefKey): void {
  Zotero.Prefs.clear(`${PREFIX}.${key}`, true);
}
