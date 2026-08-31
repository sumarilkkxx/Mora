import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = new URL("../src/app/icon.svg", import.meta.url);
const svgBuffer = await readFile(source);

async function renderPng(relativePath, size) {
  const destination = new URL(`../${relativePath}`, import.meta.url);
  const png = await sharp(svgBuffer)
    .resize(size, size)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(destination, png);
  return png;
}

function wrapPngAsIco(png, width, height) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width >= 256 ? 0 : width, 6);
  header.writeUInt8(height >= 256 ? 0 : height, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const faviconPng = await sharp(svgBuffer)
  .resize(64, 64)
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

await Promise.all([
  renderPng("src/app/apple-icon.png", 180),
  renderPng("electron/icon.png", 512),
  writeFile(new URL("../src/app/favicon.ico", import.meta.url), wrapPngAsIco(faviconPng, 64, 64)),
]);

console.log("Generated Mora icons from src/app/icon.svg");
