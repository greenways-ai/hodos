import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../../spec/", import.meta.url));
const targetRoot = fileURLToPath(
  new URL("../src/content/docs/spec/", import.meta.url),
);

const metadata = {
  "README.md": {
    output: "index.md",
    title: "Hodos specification",
    description: "The normative boundary and layer model for Hodos.",
  },
  "core.md": {
    title: "Hodos Core",
    description: "Common values, envelopes, identifiers, lifecycle, errors, and extensions.",
  },
  "world.md": {
    title: "Hodos World",
    description: "The portable, source-neutral definition of a world.",
  },
  "host-abi.md": {
    title: "Browser–Hara Host ABI",
    description: "The serializable event and effect boundary between Hara and a host.",
  },
  "capabilities.md": {
    title: "Capabilities",
    description: "Explicit authority, scope, quota, permission, and revocation.",
  },
  "engagement.md": {
    title: "Engagement",
    description: "Actors, affordances, intents, actions, effects, portals, and receipts.",
  },
  "conformance.md": {
    title: "Conformance",
    description: "Profiles, negotiation, implementation levels, fixtures, and tests.",
  },
  "profiles/web3.md": {
    title: "Web3 profile",
    description: "Chain and wallet interoperability without ambient key authority.",
  },
};

function removeLeadingTitle(markdown) {
  return markdown.replace(/^#\s+[^\n]+\n+/, "");
}

function frontmatter(title, description) {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n`;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (entry.isFile() && extname(entry.name) === ".md") output.push(path);
  }
  return output;
}

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

for (const source of await walk(sourceRoot)) {
  const key = relative(sourceRoot, source).replaceAll("\\", "/");
  const page = metadata[key];
  if (!page) throw new Error(`Missing site metadata for spec/${key}`);

  const outputKey = page.output ?? key;
  const target = join(targetRoot, outputKey);
  const body = removeLeadingTitle(await readFile(source, "utf8")).trimStart();

  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    `${frontmatter(page.title, page.description)}\n${body}`,
    "utf8",
  );
}

console.log(`Synced ${Object.keys(metadata).length} Hodos specification pages.`);
