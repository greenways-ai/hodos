import assert from "node:assert/strict";
import test from "node:test";
import { createRigDocument } from "@greenways/hodos-world-model/rigging";
import {
  RiggingWeightTaskRunner,
  executeRiggingWeightTask,
} from "../src/rigging-weight-task.js";

function document() {
  return createRigDocument({
    id: "rig:task",
    assetId: "sha256:task",
    joints: [
      { id: "root", parent: null },
      { id: "right", parent: "root", rest: { translation: [2, 0, 0] } },
    ],
  });
}

test("inline task runner executes deterministic nearest-segment weighting", async () => {
  const task = {
    strategy: "nearest-segment",
    document: document(),
    positions: new Float32Array([0, 0, 0, 2, 0, 0]),
    maxInfluences: 2,
  };
  const direct = executeRiggingWeightTask(task);
  const runner = new RiggingWeightTaskRunner();
  const result = await runner.run(task);
  assert.deepEqual([...result.jointIndices], [...direct.jointIndices]);
  assert.deepEqual([...result.weights], [...direct.weights]);
  runner.destroy();
  await assert.rejects(() => runner.run(task), /destroyed/);
});

test("worker-capable runner transfers copies and accepts typed results", async () => {
  const workers = [];
  const runner = new RiggingWeightTaskRunner({
    workerFactory() {
      const listeners = new Map();
      const worker = {
        terminated: false,
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
        postMessage(message) {
          queueMicrotask(() => {
            const result = executeRiggingWeightTask(message.task);
            listeners.get("message")?.({ data: { id: message.id, ok: true, result } });
          });
        },
        terminate() { this.terminated = true; },
      };
      workers.push(worker);
      return worker;
    },
  });
  const positions = new Float32Array([0, 0, 0, 2, 0, 0]);
  const result = await runner.run({
    strategy: "rigid-component",
    document: document(),
    positions,
    componentIds: new Uint32Array([0, 1]),
    componentCount: 2,
  });
  assert.deepEqual([...positions], [0, 0, 0, 2, 0, 0]);
  assert.ok(result.weights instanceof Float32Array);
  assert.equal(workers[0].terminated, true);
});
