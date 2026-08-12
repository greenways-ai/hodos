const encoder = new TextEncoder();

function align4(value) {
  return (value + 3) & ~3;
}

function writeFloat32(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function writeUint16(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

function binaryLayout(parts) {
  const layouts = [];
  let length = 0;
  for (const part of parts) {
    length = align4(length);
    layouts.push({ byteOffset: length, byteLength: part.byteLength });
    length += part.byteLength;
  }
  const bytes = new Uint8Array(align4(length));
  parts.forEach((part, index) => bytes.set(part, layouts[index].byteOffset));
  return { bytes, layouts };
}

export function buildGlb(document, binary = new Uint8Array()) {
  const jsonBytes = encoder.encode(JSON.stringify(document));
  const jsonLength = align4(jsonBytes.byteLength);
  const binaryLength = align4(binary.byteLength);
  const totalLength = 12 + 8 + jsonLength + (binaryLength ? 8 + binaryLength : 0);
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(jsonBytes, 20);
  if (binaryLength) {
    const chunkOffset = 20 + jsonLength;
    view.setUint32(chunkOffset, binaryLength, true);
    view.setUint32(chunkOffset + 4, 0x004e4942, true);
    bytes.set(binary, chunkOffset + 8);
  }
  return bytes;
}

export function createStylizedUnriggedGlb({ malformedSkin = false } = {}) {
  const bodyPositions = writeFloat32([
    -1, 0, 0,
     0, 1, 0,
     1, 0, 0,
    -1, 0, 2,
     0, 1, 2,
     1, 0, 2,
  ]);
  const bodyNormals = writeFloat32([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const bodyIndices = writeUint16([0, 1, 2, 3, 4, 5]);
  const ornamentPositions = writeFloat32([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const ornamentIndices = writeUint16([0, 1, 2]);
  const { bytes: binary, layouts } = binaryLayout([
    bodyPositions,
    bodyNormals,
    bodyIndices,
    ornamentPositions,
    ornamentIndices,
  ]);

  const document = {
    asset: { version: "2.0", generator: "Hodos rigging fixture" },
    scene: 0,
    scenes: [{ name: "Rigging fixture", nodes: [0, 1] }],
    nodes: [
      { name: "Disconnected body", mesh: 0, ...(malformedSkin ? { skin: 0 } : {}) },
      { name: "Detached ornament", mesh: 1, translation: [3, 0, 0] },
    ],
    meshes: [
      {
        name: "Body",
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1 },
          indices: 2,
          material: 0,
          mode: 4,
        }],
      },
      {
        name: "Ornament",
        primitives: [{
          attributes: { POSITION: 3 },
          indices: 4,
          material: 1,
          mode: 4,
        }],
      },
    ],
    materials: [{ name: "Opal" }, { name: "Gold" }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: layouts.map(({ byteOffset, byteLength }) => ({ buffer: 0, byteOffset, byteLength })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 6, type: "VEC3", min: [-1, 0, 0], max: [1, 1, 2] },
      { bufferView: 1, componentType: 5126, count: 6, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 4, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    ...(malformedSkin ? { skins: [{ name: "Broken existing skin", joints: [0] }] } : {}),
  };
  return buildGlb(document, binary);
}

export function createNonManifoldGlb() {
  const positions = writeFloat32([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, -1, 0,
    0, 0, 1,
  ]);
  const normals = writeFloat32(Array.from({ length: 5 }, () => [0, 0, 1]).flat());
  const indices = writeUint16([
    0, 1, 2,
    1, 0, 3,
    0, 1, 4,
  ]);
  const { bytes: binary, layouts } = binaryLayout([positions, normals, indices]);
  return buildGlb({
    asset: { version: "2.0", generator: "Hodos non-manifold fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: layouts.map(({ byteOffset, byteLength }) => ({ buffer: 0, byteOffset, byteLength })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 5, type: "VEC3", min: [0, -1, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: 5, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 9, type: "SCALAR" },
    ],
  }, binary);
}
