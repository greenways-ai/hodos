import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = path.join(process.cwd(), "packages");
const names = [];
for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, entry.name, "package.json"), "utf8"));
    if (!manifest.private) names.push(manifest.name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const npm = process.env.npm_execpath;
if (!npm) throw new Error("pack:check must run through npm");
const packed = [];
for (const name of names.sort()) {
  const result = spawnSync(process.execPath, [npm, "pack", "--dry-run", "--json", "--workspace", name], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  const [artifact] = JSON.parse(result.stdout);
  if (!artifact || artifact.name !== name || !artifact.entryCount) throw new Error(`npm pack did not produce ${name}`);
  packed.push({ name, files: artifact.entryCount, bytes: artifact.unpackedSize });
}

for (const artifact of packed) console.log(`${artifact.name}: ${artifact.files} files, ${artifact.bytes} bytes unpacked`);
console.log(`Validated ${packed.length} npm package tarballs`);
