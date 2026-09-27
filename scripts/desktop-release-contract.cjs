const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function required(env, names, label) {
  const missing = names.filter(name => !String(env[name] ?? "").trim());
  if (missing.length) throw new Error(`${label} missing: ${missing.join(", ")}`);
}

function hasAny(env, names) {
  return names.some(name => String(env[name] ?? "").trim());
}

function hasAll(env, names) {
  return names.every(name => String(env[name] ?? "").trim());
}

function planDesktopRelease({ platform, arch, channel, env = process.env }) {
  if (!['windows', 'macos'].includes(platform)) throw new Error(`Unsupported desktop platform: ${platform}`);
  if (!['x64', 'arm64'].includes(arch) || (platform === 'windows' && arch !== 'x64')) {
    throw new Error(`Unsupported desktop target: ${platform}/${arch}`);
  }
  if (!['development', 'official'].includes(channel)) throw new Error(`Unsupported desktop release channel: ${channel}`);
  const official = channel === 'official';
  const credentialKinds = [];
  let forceCodeSigning = false;
  if (official && platform === 'windows') {
    const names = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
    if (hasAny(env, names)) {
      required(env, names, 'Windows signing credentials');
      credentialKinds.push('windows-authenticode');
      forceCodeSigning = true;
    }
  }
  if (official && platform === 'macos') {
    const signingNames = ['CSC_LINK', 'CSC_KEY_PASSWORD'];
    const notarizationSets = [
      { kind: 'apple-api-key-notarization', names: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'] },
      { kind: 'apple-id-notarization', names: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] },
      { kind: 'apple-keychain-notarization', names: ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'] },
    ];
    const signingConfigured = hasAny(env, signingNames);
    if (signingConfigured) required(env, signingNames, 'macOS signing credentials');
    for (const set of notarizationSets) {
      if (hasAny(env, set.names)) required(env, set.names, `${set.kind} credentials`);
    }
    const notarization = notarizationSets.find(set => hasAll(env, set.names));
    if (signingConfigured !== Boolean(notarization)) {
      throw new Error('macOS optional signing requires both signing and one complete notarization credentials set');
    }
    if (signingConfigured && notarization) {
      credentialKinds.push('mac-signing', notarization.kind);
      forceCodeSigning = true;
    }
  }
  const signingExpectation = !official
    ? 'unsigned-development'
    : forceCodeSigning
      ? (platform === 'macos' ? 'signed-and-notarized' : 'authenticode-signed')
      : 'unsigned-open-source';
  return {
    schemaVersion: 2,
    platform,
    arch,
    channel,
    signingExpectation,
    artifactSuffix: official ? (forceCodeSigning ? 'signed' : 'unsigned') : 'unsigned-dev',
    forceCodeSigning,
    credentialKinds,
    releaseEligible: false,
  };
}

function finalizeDesktopRelease(plan, observed) {
  const codeSigned = observed?.codeSigned === true;
  const notarized = plan.platform === 'macos' ? observed?.notarized === true : null;
  if (plan.channel === 'official' && plan.forceCodeSigning) {
    if (!codeSigned || (plan.platform === 'windows' && observed?.signatureStatus !== 'Valid')) {
      throw new Error(plan.platform === 'windows' ? 'Official Windows artifact failed Authenticode verification' : 'Official macOS artifact failed code-sign verification');
    }
    if (plan.platform === 'macos' && !notarized) throw new Error('Official macOS artifact failed notarization verification');
  }
  return {
    ...plan,
    checkedAt: new Date().toISOString(),
    codeSigned,
    notarized,
    signatureStatus: String(observed?.signatureStatus ?? (codeSigned ? 'valid' : 'unsigned')),
    signer: observed?.signer ? String(observed.signer).slice(0, 500) : null,
    artifact: observed?.artifact ? path.basename(String(observed.artifact)) : null,
    releaseEligible: plan.channel === 'official' && (
      !plan.forceCodeSigning || (codeSigned && (plan.platform !== 'macos' || notarized))
    ),
  };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function runSystemCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}: ${output.trim()}`);
  }
  return output;
}

/** @param {{ platform: string, artifact: string, appPath?: string, run?: (command: string, args: string[], options?: object) => string }} options */
function inspectDesktopArtifact({ platform, artifact, appPath, run = runSystemCommand }) {
  if (!artifact) throw new Error("Desktop artifact path is required");
  if (platform === "macos") {
    if (!appPath) throw new Error("macOS application bundle path is required");
    let details = "";
    let codeSigned = false;
    let notarized = false;
    try {
      run("codesign", ["--verify", "--deep", "--strict", appPath]);
      details = String(run("codesign", ["-dv", "--verbose=4", appPath]) ?? "");
      codeSigned = true;
    } catch {
      codeSigned = false;
    }
    try {
      run("xcrun", ["stapler", "validate", artifact]);
      notarized = true;
    } catch {
      notarized = false;
    }
    const signer = details.match(/^Authority=(.+)$/m)?.[1]?.trim() ?? null;
    return {
      artifact,
      codeSigned,
      notarized,
      signatureStatus: codeSigned ? "valid" : "unsigned",
      signer,
    };
  }
  if (platform === "windows") {
    let signature;
    try {
      const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
      const script = "$s=Get-AuthenticodeSignature -LiteralPath $env:MORA_SIGNATURE_TARGET; [pscustomobject]@{Status=[string]$s.Status;Subject=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress";
      const output = run(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        env: { ...process.env, MORA_SIGNATURE_TARGET: artifact },
      });
      signature = JSON.parse(String(output));
    } catch {
      signature = { Status: "NotSigned", Subject: null };
    }
    const signatureStatus = String(signature.Status ?? "Unknown");
    return {
      artifact,
      codeSigned: signatureStatus === "Valid",
      notarized: null,
      signatureStatus,
      signer: signature.Subject ? String(signature.Subject) : null,
    };
  }
  throw new Error(`Unsupported desktop platform: ${platform}`);
}

module.exports = {
  finalizeDesktopRelease,
  inspectDesktopArtifact,
  planDesktopRelease,
  writeReport,
};
