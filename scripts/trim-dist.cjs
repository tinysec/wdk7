const fs = require("node:fs");

/**
 * main validates CLI arguments and applies the distribution-file cleanup.
 * Keeping the entry point explicit makes this small utility easier to extend
 * without hiding behavior in top-level expressions.
 */
function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("Usage: node scripts/trim-dist.cjs <file>");
  }

  trimFile(filePath);
}

/**
 * trimFile rewrites a bundled JavaScript file with stable whitespace. The
 * generated action bundle is committed, so deterministic whitespace keeps diffs
 * focused on real code changes.
 */
function trimFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  const trimmed = trimTrailingWhitespace(original);
  const normalized = ensureTrailingNewline(trimmed);

  fs.writeFileSync(filePath, normalized, "utf8");
}

/**
 * trimTrailingWhitespace removes line-end spaces without changing line order.
 * The explicit loop avoids a compact callback pipeline in a maintenance script
 * that contributors may need to adjust during release work.
 */
function trimTrailingWhitespace(content) {
  const lines = content.split(/\r?\n/);
  const trimmedLines = [];

  for (const line of lines) {
    trimmedLines.push(line.replace(/[ \t]+$/u, ""));
  }

  return trimmedLines.join("\n");
}

/**
 * ensureTrailingNewline preserves the normal text-file convention used by the
 * repository. Build tools can otherwise create noisy one-byte diffs.
 */
function ensureTrailingNewline(content) {
  if (content.endsWith("\n")) {
    return content;
  }

  return `${content}\n`;
}

main();
