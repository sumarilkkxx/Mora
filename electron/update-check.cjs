const RELEASES_API = "https://api.github.com/repos/sumarilkkxx/Mora/releases?per_page=20";

function versionParts(value) {
  const match = String(value).trim().match(/^v?(\d+(?:\.\d+){1,3})$/);
  if (!match) return null;
  const parts = match[1].split(".").map(Number);
  while (parts.length < 4) parts.push(0);
  return parts;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error("Invalid desktop version");
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function normalizeVersion(value) {
  const parts = versionParts(value);
  return parts ? parts.join(".") : null;
}

function trustedReleaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith("/sumarilkkxx/Mora/releases/")) {
    throw new Error("Update service returned an untrusted release link");
  }
  return url.href;
}

/** @param {{ currentVersion: string, fetchImpl?: (input: string, init?: object) => Promise<any> }} options */
async function checkForDesktopUpdate({ currentVersion, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Mora-Desktop/${currentVersion}`,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return { available: false, currentVersion, reason: "service-unavailable" };
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error("Update service returned an invalid response");
  const candidates = releases
    .filter(release => release && release.draft !== true && normalizeVersion(release.tag_name))
    .sort((left, right) => compareVersions(right.tag_name, left.tag_name));
  const latest = candidates[0];
  if (!latest || compareVersions(latest.tag_name, currentVersion) <= 0) {
    return { available: false, currentVersion, reason: "up-to-date" };
  }
  return {
    available: true,
    currentVersion,
    latestVersion: normalizeVersion(latest.tag_name),
    downloadUrl: trustedReleaseUrl(latest.html_url),
  };
}

module.exports = { checkForDesktopUpdate, compareVersions };
