import { execFile } from "child_process";
import { promisify } from "util";
import { validateMediaFile } from "@/lib/media-validate";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 2 * 60 * 1000;

/** Map the UI's intuitive multiplier to the integer rate accepted by system voices. */
export function systemVoiceRateFromMultiplier(value: unknown): number {
  const multiplier = Math.min(1.5, Math.max(0.75, Number(value) || 1));
  return Math.max(-3, Math.min(3, Math.round((multiplier - 1) * 6)));
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function localVoiceExtension(platform = process.platform): ".wav" | ".aiff" {
  return platform === "darwin" ? ".aiff" : ".wav";
}

export async function synthesizeWithSystemVoice(input: {
  text: string;
  outputPath: string;
  language: "zh" | "en";
  rate?: number;
}): Promise<void> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 12_000);
  if (!text) throw new Error("没有可用于配音的文案");
  const rate = Math.max(-3, Math.min(3, Math.round(input.rate ?? 0)));
  if (process.platform === "win32") {
    const script = [
      `$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(text)}'))`,
      `$out=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(input.outputPath)}'))`,
      "$speaker=New-Object -ComObject SAPI.SpVoice",
      `$speaker.Rate=${rate}`,
      `$needle='${input.language === "en" ? "English" : "Chinese"}'`,
      "$selected=$null",
      "foreach ($candidate in $speaker.GetVoices()) { if ($candidate.GetDescription() -like \"*$needle*\") { $selected=$candidate; break } }",
      "if ($selected) { $speaker.Voice=$selected }",
      "$stream=New-Object -ComObject SAPI.SpFileStream",
      "$stream.Format.Type=22",
      "$stream.Open($out,3,$false)",
      "$speaker.AudioOutputStream=$stream",
      "$null=$speaker.Speak($text)",
      "$stream.Close()",
      "[Runtime.InteropServices.Marshal]::ReleaseComObject($stream) | Out-Null",
      "[Runtime.InteropServices.Marshal]::ReleaseComObject($speaker) | Out-Null",
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  } else if (process.platform === "darwin") {
    await execFileAsync("say", ["-r", String(175 + rate * 18), "-o", input.outputPath, text], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  } else {
    const speed = String(175 + rate * 18);
    try {
      await execFileAsync("espeak-ng", ["-v", input.language, "-s", speed, "-w", input.outputPath, text], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      const detail = error as { code?: string };
      if (detail.code !== "ENOENT") throw error;
      await execFileAsync("espeak", ["-v", input.language, "-s", speed, "-w", input.outputPath, text], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    }
  }
  if (!(await validateMediaFile(input.outputPath, "audio"))) throw new Error("系统语音生成的音频无法解码");
}
