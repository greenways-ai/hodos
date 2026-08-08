import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseEDNString } from "edn-data";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");
const FIXED_SURFACES = new Set(["files", "code", "preview", "audio", "repl", "learn"]);

const TOP_KEYS = new Set([
  "hara/type",
  "showcase/format",
  "showcase/package",
  "showcase/version",
  "showcase/title",
  "showcase/summary",
  "showcase/views",
  "showcase/states",
  "showcase/demos",
]);
const VIEW_KEYS = new Set([
  "view/id",
  "view/title",
  "view/summary",
  "view/source",
  "view/docs",
]);
const STATE_KEYS = new Set([
  "state/id",
  "state/title",
  "state/summary",
  "state/file",
  "state/value",
]);
const DEMO_KEYS = new Set([
  "demo/id",
  "demo/title",
  "demo/summary",
  "demo/view",
  "demo/state",
  "demo/project",
  "demo/surface",
  "demo/docs",
  "demo/tags",
  "demo/theme",
  "demo/viewport",
  "demo/default",
]);
const VIEWPORT_KEYS = new Set(["viewport/width", "viewport/height"]);

const parseEdn = (source) => parseEDNString(source, {
  mapAs: "object",
  setAs: "array",
  listAs: "array",
  keywordAs: "string",
  charAs: "string",
  objectKeysAs: "string",
});

function map(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a map`);
  }
  return value;
}

function vector(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a vector`);
  return value;
}

function token(value, label) {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? typeof value.sym === "string"
        ? value.sym
        : typeof value.symbol === "string"
          ? value.symbol
          : typeof value.name === "string"
            ? value.name
            : ""
      : "";
  if (!candidate.trim()) {
    throw new TypeError(`${label} must be an identifier`);
  }
  return candidate.trim().replace(/^:/, "");
}

function knownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field :${key}`);
  }
}

function unique(values, label) {
  const result = new Set();
  for (const value of values) {
    if (result.has(value)) throw new Error(`Duplicate ${label} id: ${value}`);
    result.add(value);
  }
  return result;
}

function relativePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a relative path`);
  }
  const normalized = value.trim();
  if (
    normalized.startsWith("/")
    || normalized.endsWith("/")
    || normalized.includes("\\")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a normalized relative path`);
  }
  return normalized;
}

function targetPath(packageDirectory, value, label) {
  const relative = relativePath(value, label);
  const target = path.resolve(packageDirectory, relative);
  if (target !== packageDirectory && !target.startsWith(`${packageDirectory}${path.sep}`)) {
    throw new Error(`${label} escaped the package root`);
  }
  return { relative, target };
}

async function requireEntry(packageDirectory, value, expected, label) {
  const resolved = targetPath(packageDirectory, value, label);
  let metadata;
  try {
    metadata = await stat(resolved.target);
  } catch {
    throw new Error(`${label} is missing: ${resolved.relative}`);
  }
  if (expected === "file" && !metadata.isFile()) {
    throw new Error(`${label} must be a file: ${resolved.relative}`);
  }
  if (expected === "directory" && !metadata.isDirectory()) {
    throw new Error(`${label} must be a directory: ${resolved.relative}`);
  }
  return resolved;
}

function workspaceSurfaces(workspace) {
  if (token(workspace["hara/type"], "Workspace :hara/type") !== "workspace") {
    throw new Error("Showcase demo workspace.edn must declare :hara/type :workspace");
  }
  const surfaces = new Set(FIXED_SURFACES);
  const add = (value) => {
    if (typeof value === "string" && value.trim()) surfaces.add(value.trim().replace(/^:/, ""));
  };
  const selection = workspace["workspace/selection"];
  if (selection && typeof selection === "object") add(selection["surface/id"]);
  const customizations = workspace["workspace/customizations"];
  if (customizations && typeof customizations === "object") {
    add(customizations["responsive/default-surface"]);
    for (const surface of customizations["responsive/surfaces"] || []) {
      if (surface && typeof surface === "object") add(surface["surface/id"]);
    }
  }
  for (const area of workspace["workspace/areas"] || []) {
    const presentation = area?.["area/presentation"];
    if (presentation && typeof presentation === "object") {
      add(presentation["presentation/surface"]);
    }
  }
  return surfaces;
}

async function validateDemoProject(packageDirectory, demo) {
  const project = await requireEntry(
    packageDirectory,
    demo.project,
    "directory",
    `Showcase demo ${demo.id} project`,
  );
  const projectFile = await requireEntry(
    packageDirectory,
    path.posix.join(project.relative, "project.edn"),
    "file",
    `Showcase demo ${demo.id} project.edn`,
  );
  const workspaceFile = await requireEntry(
    packageDirectory,
    path.posix.join(project.relative, "workspace.edn"),
    "file",
    `Showcase demo ${demo.id} workspace.edn`,
  );
  await requireEntry(
    packageDirectory,
    path.posix.join(project.relative, "README.md"),
    "file",
    `Showcase demo ${demo.id} README`,
  );
  const descriptor = parseEdn(await readFile(projectFile.target, "utf8"));
  if (descriptor["hara/type"] !== "project") {
    throw new Error(`Showcase demo ${demo.id} project.edn must declare :hara/type :project`);
  }
  const workspace = parseEdn(await readFile(workspaceFile.target, "utf8"));
  const surfaces = workspaceSurfaces(workspace);
  if (!surfaces.has(demo.surface)) {
    throw new Error(
      `Showcase demo ${demo.id} selects undeclared surface ${demo.surface} in ${project.relative}/workspace.edn`,
    );
  }
}

async function validateShowcase(directory, manifest, packageManifest, project) {
  knownKeys(manifest, TOP_KEYS, `${packageManifest.name} Showcase`);
  if (token(manifest["hara/type"], "Showcase :hara/type") !== "showcase") {
    throw new Error(`${packageManifest.name}: showcase.edn must declare :hara/type :showcase`);
  }
  if (manifest["showcase/format"] !== 1) {
    throw new Error(`${packageManifest.name}: unsupported Showcase format`);
  }
  if (manifest["showcase/source"] !== undefined) {
    throw new Error(`${packageManifest.name}: source-local showcase.edn must not declare :showcase/source`);
  }
  if (
    token(manifest["showcase/package"], "Showcase package")
    !== token(project["project/id"], "Project id")
  ) {
    throw new Error(`${packageManifest.name}: Showcase package must match project.edn`);
  }
  if (manifest["showcase/version"] !== project["project/version"]) {
    throw new Error(`${packageManifest.name}: Showcase version must match project.edn`);
  }

  const views = vector(manifest["showcase/views"], `${packageManifest.name} Showcase views`);
  const states = vector(manifest["showcase/states"] || [], `${packageManifest.name} Showcase states`);
  const demos = vector(manifest["showcase/demos"], `${packageManifest.name} Showcase demos`);
  if (!views.length) throw new Error(`${packageManifest.name}: Showcase requires at least one view`);
  if (!demos.length) throw new Error(`${packageManifest.name}: Showcase requires at least one demo`);

  const normalizedViews = [];
  for (const [index, value] of views.entries()) {
    const view = map(value, `Showcase view ${index}`);
    knownKeys(view, VIEW_KEYS, `Showcase view ${index}`);
    const normalized = {
      id: token(view["view/id"], `Showcase view ${index} id`),
    };
    if (view["view/source"]) {
      normalized.source = (await requireEntry(
        directory,
        view["view/source"],
        "file",
        `Showcase view ${normalized.id} source`,
      )).relative;
    }
    if (view["view/docs"]) {
      normalized.docs = (await requireEntry(
        directory,
        view["view/docs"],
        "file",
        `Showcase view ${normalized.id} docs`,
      )).relative;
    }
    normalizedViews.push(normalized);
  }

  const normalizedStates = [];
  for (const [index, value] of states.entries()) {
    const stateValue = map(value, `Showcase state ${index}`);
    knownKeys(stateValue, STATE_KEYS, `Showcase state ${index}`);
    const normalized = {
      id: token(stateValue["state/id"], `Showcase state ${index} id`),
    };
    if (stateValue["state/file"]) {
      if (!String(stateValue["state/file"]).endsWith(".edn")) {
        throw new Error(`Showcase state ${normalized.id} file must use .edn`);
      }
      const file = await requireEntry(
        directory,
        stateValue["state/file"],
        "file",
        `Showcase state ${normalized.id} file`,
      );
      parseEdn(await readFile(file.target, "utf8"));
      normalized.file = file.relative;
    }
    if (!normalized.file && !Object.hasOwn(stateValue, "state/value")) {
      throw new Error(`Showcase state ${normalized.id} requires :state/file or :state/value`);
    }
    normalizedStates.push(normalized);
  }

  const viewIds = unique(normalizedViews.map((view) => view.id), "view");
  const stateIds = unique(normalizedStates.map((state) => state.id), "state");
  const normalizedDemos = [];
  let defaults = 0;
  for (const [index, value] of demos.entries()) {
    const demoValue = map(value, `Showcase demo ${index}`);
    knownKeys(demoValue, DEMO_KEYS, `Showcase demo ${index}`);
    if (demoValue["demo/viewport"]) {
      knownKeys(
        map(demoValue["demo/viewport"], `Showcase demo ${index} viewport`),
        VIEWPORT_KEYS,
        `Showcase demo ${index} viewport`,
      );
    }
    const demo = {
      id: token(demoValue["demo/id"], `Showcase demo ${index} id`),
      view: token(demoValue["demo/view"], `Showcase demo ${index} view`),
      state: demoValue["demo/state"]
        ? token(demoValue["demo/state"], `Showcase demo ${index} state`)
        : null,
      project: relativePath(demoValue["demo/project"], `Showcase demo ${index} project`),
      surface: token(demoValue["demo/surface"], `Showcase demo ${index} surface`),
    };
    if (!viewIds.has(demo.view)) {
      throw new Error(`Showcase demo ${demo.id} references missing view ${demo.view}`);
    }
    if (demo.state && !stateIds.has(demo.state)) {
      throw new Error(`Showcase demo ${demo.id} references missing state ${demo.state}`);
    }
    if (demoValue["demo/docs"]) {
      await requireEntry(
        directory,
        demoValue["demo/docs"],
        "file",
        `Showcase demo ${demo.id} docs`,
      );
    }
    if (demoValue["demo/default"] === true) defaults += 1;
    await validateDemoProject(directory, demo);
    normalizedDemos.push(demo);
  }
  unique(normalizedDemos.map((demo) => demo.id), "demo");
  if (defaults > 1) throw new Error(`${packageManifest.name}: Showcase may declare only one default demo`);

  const publishedFiles = new Set(packageManifest.files || []);
  for (const required of ["showcase.edn", "showcase"]) {
    if (!publishedFiles.has(required)) {
      throw new Error(`${packageManifest.name}: package.json files must include ${required}`);
    }
  }
}

const errors = [];
let showcases = 0;
for (const entry of (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((candidate) => candidate.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))) {
  const directory = path.join(packagesRoot, entry.name);
  try {
    const packageManifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (packageManifest.private) continue;
    try {
      await access(path.join(directory, "showcase.edn"));
    } catch {
      continue;
    }
    const project = parseEdn(await readFile(path.join(directory, "project.edn"), "utf8"));
    const showcase = parseEdn(await readFile(path.join(directory, "showcase.edn"), "utf8"));
    await validateShowcase(directory, showcase, packageManifest, project);
    showcases += 1;
  } catch (error) {
    errors.push(`${entry.name}: ${error.message}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${showcases} package Showcase${showcases === 1 ? "" : "s"}`);
}
