import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseEDNString } from "edn-data";

const root = process.cwd();
const packageRoot = path.join(root, "packages");
const directories = (await readdir(packageRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const manifests = new Map();
for (const directory of directories) {
  const packageJson = path.join(packageRoot, directory, "package.json");
  try {
    const manifest = JSON.parse(await readFile(packageJson, "utf8"));
    if (!manifest.private) manifests.set(manifest.name, { directory, manifest });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const errors = [];
const parseEdn = (source) => parseEDNString(source, {
  mapAs: "object",
  setAs: "array",
  listAs: "array",
  keywordAs: "string",
  charAs: "string",
  objectKeysAs: "string",
});

async function validateHaraProject(label, directory, version) {
  try {
    const project = parseEdn(await readFile(path.join(directory, "project.edn"), "utf8"));
    const recipe = parseEdn(await readFile(path.join(directory, "hara.recipe.edn"), "utf8"));
    if (project["hara/type"] !== "project") errors.push(`${label}: :hara/type must be :project`);
    if (project["hara/version"] !== "1.0.0") errors.push(`${label}: unsupported :hara/version`);
    if (project["project/version"] !== version) errors.push(`${label}: npm and Hara versions must both be ${version}`);
    for (const key of ["project/id", "project/source-paths", "project/test-paths", "project/extension-paths", "project/capabilities", "project/dependencies"]) {
      if (project[key] === undefined) errors.push(`${label}: project.edn is missing :${key}`);
    }
    if (project["project/recipe"] !== "hara.recipe.edn") errors.push(`${label}: :project/recipe must select hara.recipe.edn`);
    if (recipe["recipe/format"] !== "0.0.0-alpha") errors.push(`${label}: :recipe/format must be 0.0.0-alpha`);
    if (!new Set(["hal", "node-hta"]).has(recipe["recipe/adapter"])) errors.push(`${label}: unsupported :recipe/adapter`);
    if (!recipe["recipe/toolchain"] || !recipe["recipe/inputs"] || !Array.isArray(recipe["recipe/outputs"])) {
      errors.push(`${label}: recipe requires toolchain, inputs, and outputs`);
    }
    return project;
  } catch (error) {
    errors.push(`${label}: invalid Hara package metadata (${error.message})`);
    return null;
  }
}

for (const [name, { directory, manifest }] of manifests) {
  const packageDirectory = path.join(packageRoot, directory);
  if (!name?.startsWith("@greenways/hodos")) errors.push(`${directory}: invalid public package name ${name}`);
  if (!manifest.version) errors.push(`${name}: version is required`);
  if (manifest.license !== "EPL-2.0") errors.push(`${name}: license must be EPL-2.0`);
  if (manifest.publishConfig?.access !== "public") errors.push(`${name}: publishConfig.access must be public`);
  if (!manifest.repository?.directory) errors.push(`${name}: repository.directory is required`);
  for (const filename of ["project.edn", "project.lock.edn", "hara.recipe.edn", "README.md"]) {
    try { await access(path.join(packageDirectory, filename)); }
    catch { errors.push(`${name}: missing ${filename}`); }
  }
  const haraProject = await validateHaraProject(name, packageDirectory, manifest.version);
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    const workspace = manifests.get(dependency)?.manifest;
    if (!workspace) continue;
    if (range !== workspace.version) errors.push(`${name}: ${dependency} must use workspace release ${workspace.version}, found ${range}`);
    const haraDependency = `hara:${dependency.slice(1)}`;
    const haraRange = haraProject?.["project/dependencies"]?.[haraDependency]?.version;
    if (!haraRange) errors.push(`${name}: project.edn must declare ${haraDependency}`);
    else if (haraRange !== `^${workspace.version}`) {
      errors.push(`${name}: ${haraDependency} must use ^${workspace.version}, found ${haraRange}`);
    }
  }
}
await validateHaraProject("greenways/hodos", root, JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${manifests.size} deployable Hodos packages`);
}
