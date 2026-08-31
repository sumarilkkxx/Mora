import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const buildVersion = manifest?.build?.buildVersion;
const actualTag = process.env.GITHUB_REF_NAME;

if (typeof buildVersion !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(buildVersion)) {
  console.error("package.json build.buildVersion 必须是四段数字版本号");
  process.exit(1);
}

const expectedTag = `v${buildVersion}`;
if (actualTag !== expectedTag) {
  console.error(`发布标签不匹配：期望 ${expectedTag}，实际 ${actualTag || "<empty>"}`);
  process.exit(1);
}

console.log(`发布版本校验通过：${expectedTag}`);
