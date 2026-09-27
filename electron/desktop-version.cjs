function resolveDesktopVersion(electronApp) {
  const version = String(electronApp?.getVersion?.() ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
    throw new Error(`Invalid desktop version: ${version || "<empty>"}`);
  }
  return version;
}

module.exports = { resolveDesktopVersion };
