import assert from "node:assert/strict";
import test from "node:test";
import { RiggingWeightSelectionStore } from "../src/rigging-weight-selections.js";

function geometry() {
  return {
    positions: new Float32Array([
      0, 0, 0,
      0.5, 0, 0,
      2, 0, 0,
      2.5, 0, 0,
    ]),
    componentIds: new Uint32Array([0, 0, 1, 1]),
    componentCount: 2,
    vertexCount: 4,
  };
}

test("sphere and component selections remain opaque and deterministic", () => {
  const store = new RiggingWeightSelectionStore({ geometry: geometry(), id: "selection:test" });
  try {
    const sphere = store.selectSphere({ center: [0, 0, 0], radius: 0.75 });
    assert.match(sphere.id, /^selection:test:/);
    assert.equal(sphere.vertices, 2);
    assert.deepEqual([...store.read(sphere.id)], [0, 1]);
    const component = store.selectComponents({ seedVertices: [2] });
    assert.deepEqual([...store.read(component.id)], [2, 3]);
    const union = store.union([sphere.id, component.id]);
    assert.deepEqual([...store.read(union.id)], [0, 1, 2, 3]);
    assert.equal(JSON.stringify(store.describe(union.id)).includes("Uint32Array"), false);
  } finally {
    store.destroy();
  }
});

test("selection bounds fail closed without retaining partial selections", () => {
  const store = new RiggingWeightSelectionStore({
    geometry: geometry(),
    maximumVerticesPerSelection: 2,
    maximumTotalEntries: 3,
  });
  try {
    assert.throws(() => store.selectSphere({ center: [1, 0, 0], radius: 5 }), /bounded limit/);
    const one = store.selectVertices([0, 1]);
    assert.throws(() => store.selectVertices([2, 3]), /entry limit/);
    assert.equal(store.evidence().selections, 1);
    assert.equal(store.release(one.id), true);
    assert.equal(store.release(one.id), false);
  } finally {
    store.destroy();
  }
});


test("duplicate-heavy and DataView selections are rejected before unbounded canonicalization", () => {
  const store = new RiggingWeightSelectionStore({
    geometry: geometry(),
    maximumVerticesPerSelection: 2,
  });
  try {
    assert.throws(() => store.selectVertices([0, 0, 0]), /input exceeds/);
    assert.throws(() => store.selectVertices(new DataView(new ArrayBuffer(8))), /array or typed array/);
    assert.throws(() => store.selectComponents({ components: [0, 0, 0] }), /component count/);
    assert.equal(store.evidence().selections, 0);
  } finally {
    store.destroy();
  }
});

test("release and destroy zero retained selection buffers", () => {
  const store = new RiggingWeightSelectionStore({ geometry: geometry() });
  const first = store.selectVertices([1, 2]);
  const retained = store.record(first.id).vertices;
  store.release(first.id);
  assert.deepEqual([...retained], [0, 0]);
  const second = store.selectComponents({ components: [1] });
  const retainedSecond = store.record(second.id).vertices;
  store.destroy();
  assert.deepEqual([...retainedSecond], [0, 0]);
  assert.equal(store.evidence().status, "destroyed");
});
