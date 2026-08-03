import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findForbiddenHalReferences } from "../../../scripts/audit-hal.js";

test("HAL namespace audit reports forbidden references with locations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hodos-hal-audit-"));
  try {
    await mkdir(path.join(root, "src"));
    const source = path.join(root, "src", "world.hal");
    await writeFile(source, "(ns gw.world)\n(def value 1)\n");
    assert.deepEqual(await findForbiddenHalReferences(root), []);
    await writeFile(source, "(ns gw.world)\n(def old greenways.world/value)\n");
    assert.deepEqual(await findForbiddenHalReferences(root), [{
      path: path.join("src", "world.hal"),
      line: 2,
      text: "greenways.",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
