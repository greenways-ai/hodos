import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "test-results", "playwright-report"]);
const FORBIDDEN = /greenways\./g;

async function visit(directory, root, findings) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(absolute, root, findings);
    } else if (entry.isFile() && entry.name.endsWith(".hal")) {
      const source = await readFile(absolute, "utf8");
      for (const match of source.matchAll(FORBIDDEN)) {
        const before = source.slice(0, match.index);
        const line = before.split("\n").length;
        findings.push({ path: path.relative(root, absolute), line, text: match[0] });
      }
    }
  }
}

export async function findForbiddenHalReferences(root = process.cwd()) {
  const findings = [];
  await visit(path.resolve(root), path.resolve(root), findings);
  return findings;
}

async function main() {
  const findings = await findForbiddenHalReferences();
  if (!findings.length) {
    console.log("HAL namespace audit passed");
    return;
  }
  console.error("HAL namespace audit found forbidden greenways.* references:");
  for (const finding of findings) console.error(`${finding.path}:${finding.line}: ${finding.text}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
