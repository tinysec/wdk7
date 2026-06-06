const fs = require("node:fs");

const filePath = process.argv[2];
if (!filePath) {
  throw new Error("Usage: node scripts/trim-dist.cjs <file>");
}

const original = fs.readFileSync(filePath, "utf8");
const trimmed = original
  .split(/\r?\n/)
  .map(line => line.replace(/[ \t]+$/u, ""))
  .join("\n");

fs.writeFileSync(filePath, trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`, "utf8");
