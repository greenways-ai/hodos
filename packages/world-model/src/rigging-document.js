import {
  AXES,
  clonePortable,
  isPlainObject,
  normalizeQuaternion,
  optionalString,
  requiredString,
} from "./rigging-values.js";
import {
  normalizeBind,
  normalizeJoint,
  normalizeRigDocument,
  normalizeSkin,
} from "./rigging-validation.js";

function nextRigRevision(document, patch) {
  return normalizeRigDocument({ ...document, ...patch, revision: document.revision + 1 });
}

function canonicalDocument(value) {
  return normalizeRigDocument(value);
}

export function addRigJoint(documentValue, jointValue) {
  const document = canonicalDocument(documentValue);
  const joint = normalizeJoint(jointValue, document.joints.length);
  return nextRigRevision(document, { joints: [...document.joints, joint] });
}

export function updateRigJoint(documentValue, jointId, patch = {}) {
  const document = canonicalDocument(documentValue);
  const id = requiredString(jointId, "jointId");
  if (!isPlainObject(patch)) throw new TypeError("Joint patch must be an object");
  if (patch.id !== undefined || patch.parent !== undefined) {
    throw new TypeError("Use renameRigJoint or reparentRigJoint to change joint identity or parent");
  }
  let found = false;
  const joints = document.joints.map((joint, index) => {
    if (joint.id !== id) return joint;
    found = true;
    const portablePatch = clonePortable(patch);
    let rest = joint.rest;
    if (portablePatch.rest !== undefined) {
      if (!isPlainObject(portablePatch.rest)) throw new TypeError("Joint rest patch must be an object");
      rest = { ...joint.rest, ...portablePatch.rest };
    }
    let limits = joint.limits;
    if (portablePatch.limits !== undefined) {
      if (portablePatch.limits === null) limits = null;
      else {
        if (!isPlainObject(portablePatch.limits)) throw new TypeError("Joint limits patch must be null or an object");
        const axes = portablePatch.limits.axes === undefined
          ? joint.limits?.axes
          : isPlainObject(portablePatch.limits.axes)
            ? { ...(joint.limits?.axes ?? {}), ...portablePatch.limits.axes }
            : portablePatch.limits.axes;
        limits = {
          ...(joint.limits ?? {}),
          ...portablePatch.limits,
          ...(axes === undefined ? {} : { axes }),
        };
      }
    }
    return normalizeJoint({
      ...joint,
      ...portablePatch,
      id: joint.id,
      parent: joint.parent,
      rest,
      limits,
    }, index);
  });
  if (!found) throw new RangeError(`Unknown joint: ${id}`);
  return nextRigRevision(document, { joints });
}

export function renameRigJoint(documentValue, jointId, nextIdValue) {
  const document = canonicalDocument(documentValue);
  const id = requiredString(jointId, "jointId");
  const nextId = requiredString(nextIdValue, "nextId");
  if (!document.joints.some((joint) => joint.id === id)) throw new RangeError(`Unknown joint: ${id}`);
  if (id !== nextId && document.joints.some((joint) => joint.id === nextId)) throw new RangeError(`Joint already exists: ${nextId}`);
  const joints = document.joints.map((joint) => ({
    ...joint,
    id: joint.id === id ? nextId : joint.id,
    parent: joint.parent === id ? nextId : joint.parent,
  }));
  return nextRigRevision(document, { joints });
}

export function reparentRigJoint(documentValue, jointId, parentIdValue) {
  const document = canonicalDocument(documentValue);
  const id = requiredString(jointId, "jointId");
  const parent = optionalString(parentIdValue, "parentId");
  if (!document.joints.some((joint) => joint.id === id)) throw new RangeError(`Unknown joint: ${id}`);
  if (parent !== null && !document.joints.some((joint) => joint.id === parent)) throw new RangeError(`Unknown parent joint: ${parent}`);
  const joints = document.joints.map((joint) => joint.id === id ? { ...joint, parent } : joint);
  return nextRigRevision(document, { joints });
}

export function deleteRigJoint(documentValue, jointId, { cascade = false } = {}) {
  const document = canonicalDocument(documentValue);
  const id = requiredString(jointId, "jointId");
  if (!document.joints.some((joint) => joint.id === id)) throw new RangeError(`Unknown joint: ${id}`);
  const removal = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const joint of document.joints) {
      if (joint.parent && removal.has(joint.parent) && !removal.has(joint.id)) {
        if (!cascade) throw new RangeError(`Joint ${id} has child ${joint.id}; enable cascade to remove its subtree`);
        removal.add(joint.id);
        changed = true;
      }
    }
  }
  return nextRigRevision(document, { joints: document.joints.filter((joint) => !removal.has(joint.id)) });
}

function mirroredQuaternion(quaternion, axis) {
  const [x, y, z, w] = quaternion;
  if (axis === "x") return [x, -y, -z, w];
  if (axis === "y") return [-x, y, -z, w];
  return [-x, -y, z, w];
}

export function mirrorRigJoints(documentValue, { jointIds, idMap, axis = "x" } = {}) {
  const document = canonicalDocument(documentValue);
  if (!AXES.includes(axis)) throw new TypeError("Mirror axis must be x, y, or z");
  if (!Array.isArray(jointIds) || jointIds.length === 0) throw new TypeError("jointIds must be a non-empty array");
  if (!isPlainObject(idMap)) throw new TypeError("idMap must be a plain object");
  const selectedIds = [...new Set(jointIds.map((entry, index) => requiredString(entry, `jointIds[${index}]`)))];
  const selected = new Set(selectedIds);
  const jointById = new Map(document.joints.map((joint) => [joint.id, joint]));
  const targetIds = new Set();
  for (const id of selectedIds) {
    if (!jointById.has(id)) throw new RangeError(`Unknown joint: ${id}`);
    const targetId = requiredString(idMap[id], `idMap.${id}`);
    if (jointById.has(targetId)) throw new RangeError(`Mirrored joint already exists: ${targetId}`);
    if (targetIds.has(targetId)) throw new RangeError(`Mirrored id is not unique: ${targetId}`);
    targetIds.add(targetId);
  }
  const axisIndex = AXES.indexOf(axis);
  const mirrored = selectedIds.map((id) => {
    const joint = jointById.get(id);
    const translation = [...joint.rest.translation];
    translation[axisIndex] *= -1;
    return {
      ...clonePortable(joint),
      id: idMap[id],
      parent: joint.parent && selected.has(joint.parent) ? idMap[joint.parent] : joint.parent,
      rest: {
        ...clonePortable(joint.rest),
        translation,
        rotation: mirroredQuaternion(joint.rest.rotation, axis),
      },
    };
  });
  return nextRigRevision(document, { joints: [...document.joints, ...mirrored] });
}

export function attachRigSkin(documentValue, skinPatch = {}, bindPatch = {}) {
  const document = canonicalDocument(documentValue);
  if (!isPlainObject(skinPatch) || !isPlainObject(bindPatch)) throw new TypeError("Skin and bind patches must be objects");
  return nextRigRevision(document, {
    skin: normalizeSkin({ ...document.skin, ...clonePortable(skinPatch) }),
    bind: normalizeBind({ ...document.bind, ...clonePortable(bindPatch) }),
  });
}

function quaternionMultiply(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotateVector(quaternion, vectorValue) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vectorValue;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function rigRestWorldTransforms(documentValue) {
  const document = canonicalDocument(documentValue);
  const jointById = new Map(document.joints.map((joint) => [joint.id, joint]));
  const worldById = new Map();
  function resolve(id) {
    if (worldById.has(id)) return worldById.get(id);
    const joint = jointById.get(id);
    let world;
    if (!joint.parent) {
      world = {
        translation: [...joint.rest.translation],
        rotation: [...joint.rest.rotation],
        scale: [...joint.rest.scale],
      };
    } else {
      const parent = resolve(joint.parent);
      const scaledTranslation = joint.rest.translation.map((entry, axis) => entry * parent.scale[axis]);
      const rotatedTranslation = rotateVector(parent.rotation, scaledTranslation);
      world = {
        translation: rotatedTranslation.map((entry, axis) => entry + parent.translation[axis]),
        rotation: normalizeQuaternion(quaternionMultiply(parent.rotation, joint.rest.rotation), `world.${id}.rotation`),
        scale: joint.rest.scale.map((entry, axis) => entry * parent.scale[axis]),
      };
    }
    worldById.set(id, world);
    return world;
  }
  return document.joints.map((joint, index) => ({
    id: joint.id,
    index,
    parent: joint.parent,
    ...resolve(joint.id),
  }));
}

export function rigJointSegments(documentValue) {
  const document = canonicalDocument(documentValue);
  const transforms = rigRestWorldTransforms(document);
  const byId = new Map(transforms.map((transform) => [transform.id, transform]));
  return transforms.map((transform) => {
    const start = transform.parent ? byId.get(transform.parent).translation : transform.translation;
    const end = transform.translation;
    return {
      jointId: transform.id,
      jointIndex: transform.index,
      start: [...start],
      end: [...end],
      length: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
    };
  });
}

export function rigMetrics(documentValue) {
  const document = canonicalDocument(documentValue);
  const children = new Map(document.joints.map((joint) => [joint.id, []]));
  for (const joint of document.joints) if (joint.parent) children.get(joint.parent).push(joint.id);
  const roots = document.joints.filter((joint) => joint.parent === null).map((joint) => joint.id);
  let maxDepth = 0;
  const visit = (id, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    for (const child of children.get(id) ?? []) visit(child, depth + 1);
  };
  roots.forEach((root) => visit(root, 0));
  return {
    jointCount: document.joints.length,
    rootCount: roots.length,
    leafCount: document.joints.filter((joint) => (children.get(joint.id) ?? []).length === 0).length,
    maxDepth,
    hasWeights: Boolean(document.skin.weightSetId),
    hasInverseBindMatrices: Boolean(document.bind.inverseMatricesId),
  };
}
