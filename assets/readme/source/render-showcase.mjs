import { resolve, join } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..", "..", "..");
const readmeDir = join(root, "assets", "readme");
const videoDir = join(root, "docs", "videos");

const palette = {
  bg: "#07111C",
  panel: "#0B2032",
  line: "#28526F",
  blue: "#087BDF",
  ice: "#8EDBFF",
  text: "#F4FAFF",
  muted: "#A8BDD0",
  dim: "#607B91",
  green: "#62D6A5",
};

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  })[character]);
}

async function roundedImage(path, width, height, radius = 22) {
  const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`);
  return sharp(path)
    .resize(width, height, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

function baseSvg({ width, height, title, eyebrow, description, chips = [], compact = false }) {
  const chipMarkup = chips.map((chip, index) => {
    const x = compact ? 708 + index * 128 : 446 + index * 150;
    const chipWidth = compact ? 116 : 136;
    return `<g transform="translate(${x} ${compact ? 459 : 198})"><rect width="${chipWidth}" height="34" rx="17" fill="#0D355A" stroke="${palette.line}"/><text x="${chipWidth / 2}" y="22" text-anchor="middle" fill="${palette.ice}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" font-weight="700">${escapeXml(chip)}</text></g>`;
  }).join("");
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse"><stop stop-color="${palette.bg}"/><stop offset="1" stop-color="#0D2C45"/></linearGradient></defs>
      <rect width="${width}" height="${height}" rx="30" fill="url(#bg)"/>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="29" fill="none" stroke="${palette.line}"/>
      <text x="${compact ? 708 : 446}" y="${compact ? 88 : 76}" fill="${palette.ice}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" font-weight="700" letter-spacing="2">${escapeXml(eyebrow)}</text>
      <text x="${compact ? 708 : 446}" y="${compact ? 145 : 128}" fill="${palette.text}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif" font-size="${compact ? 42 : 48}" font-weight="750">${escapeXml(title)}</text>
      <text x="${compact ? 708 : 446}" y="${compact ? 187 : 174}" fill="${palette.muted}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif" font-size="21">${escapeXml(description)}</text>
      ${chipMarkup}
    </svg>`);
}

async function renderGenerative() {
  const poster = await roundedImage(join(videoDir, "mora-ai-showcase.jpg"), 292, 520, 24);
  const strip = await roundedImage(join(videoDir, "mora-ai-showcase-strip.jpg"), 694, 246, 18);
  const base = baseSvg({
    width: 1200,
    height: 640,
    eyebrow: "REAL OUTPUT 01 · GENERATIVE PATH",
    title: "30 秒商品短片",
    description: "脚本、参考画面与镜头节奏，汇成一条完整生成式视频。",
    chips: ["30.0 SEC", "1080×1920", "H.264 + AAC"],
  });
  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640">
      <rect x="70" y="60" width="312" height="540" rx="30" fill="none" stroke="${palette.ice}" stroke-opacity="0.45"/>
      <circle cx="226" cy="330" r="42" fill="${palette.blue}" fill-opacity="0.92"/><path d="M214 306L246 330L214 354Z" fill="white"/>
      <rect x="446" y="256" width="694" height="246" rx="18" fill="none" stroke="${palette.line}"/>
      <path d="M446 530H1140" stroke="${palette.line}" stroke-width="2"/>
      <path d="M446 530H1136" stroke="${palette.blue}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="1136" cy="530" r="8" fill="${palette.ice}"/>
      <text x="446" y="578" fill="${palette.text}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif" font-size="21" font-weight="700">▶ 点击作品板播放完整视频</text>
      <text x="1118" y="578" text-anchor="end" fill="${palette.dim}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16">CLICK TO WATCH</text>
    </svg>`);
  await sharp(base)
    .composite([
      { input: poster, left: 80, top: 70 },
      { input: strip, left: 446, top: 256 },
      { input: overlay },
    ])
    .webp({ quality: 90 })
    .toFile(join(readmeDir, "showcase-generative.webp"));
}

async function renderGuided() {
  const source = await roundedImage(join(videoDir, "gallery", "salon-source.jpg"), 230, 408, 22);
  const output = await roundedImage(join(videoDir, "mora-guided-edit-latest.jpg"), 230, 408, 22);
  const base = baseSvg({
    width: 1200,
    height: 560,
    eyebrow: "REAL OUTPUT 02 · GUIDED LOCAL EDIT",
    title: "已有素材，重新成片",
    description: "原片保留 · 配音字幕 · 本地渲染",
    chips: ["16.4 SEC", "LOCAL RENDER", "CAPTIONS"],
    compact: true,
  });
  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="560">
      <rect x="58" y="48" width="250" height="428" rx="28" fill="none" stroke="${palette.line}"/>
      <rect x="382" y="48" width="250" height="428" rx="28" fill="none" stroke="${palette.ice}" stroke-opacity="0.55"/>
      <rect x="83" y="70" width="70" height="28" rx="14" fill="#162B3B"/><text x="118" y="89" text-anchor="middle" fill="${palette.muted}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">SOURCE</text>
      <rect x="407" y="70" width="78" height="28" rx="14" fill="${palette.blue}"/><text x="446" y="89" text-anchor="middle" fill="white" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700">OUTPUT</text>
      <path d="M328 238H362" stroke="${palette.ice}" stroke-width="3"/><path d="M353 229L364 238L353 247" fill="none" stroke="${palette.ice}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <g transform="translate(708 244)" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif">
        <circle cx="12" cy="12" r="12" fill="${palette.blue}"/><text x="12" y="18" text-anchor="middle" fill="white" font-size="15" font-weight="700">1</text><text x="38" y="19" fill="${palette.text}" font-size="20" font-weight="700">拆分场景</text>
        <path d="M12 34V75" stroke="${palette.line}" stroke-width="2"/>
        <circle cx="12" cy="96" r="12" fill="${palette.blue}"/><text x="12" y="102" text-anchor="middle" fill="white" font-size="15" font-weight="700">2</text><text x="38" y="103" fill="${palette.text}" font-size="20" font-weight="700">整理脚本节拍</text>
        <path d="M12 118V159" stroke="${palette.line}" stroke-width="2"/>
        <circle cx="12" cy="180" r="12" fill="${palette.ice}"/><text x="12" y="186" text-anchor="middle" fill="${palette.bg}" font-size="15" font-weight="700">3</text><text x="38" y="187" fill="${palette.text}" font-size="20" font-weight="700">配音字幕 · 本地渲染</text>
      </g>
      <text x="708" y="519" fill="${palette.ice}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif" font-size="20" font-weight="700">▶ 点击查看本地剪辑成片</text>
    </svg>`);
  await sharp(base)
    .composite([
      { input: source, left: 68, top: 58 },
      { input: output, left: 392, top: 58 },
      { input: overlay },
    ])
    .webp({ quality: 90 })
    .toFile(join(readmeDir, "showcase-guided.webp"));
}

await Promise.all([renderGenerative(), renderGuided()]);
console.log("README showcase boards generated");
