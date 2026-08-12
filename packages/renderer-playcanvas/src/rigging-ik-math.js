export const EPSILON = 1e-9;
export const IDENTITY = Object.freeze([0, 0, 0, 1]);
const AXES = Object.freeze(["x", "y", "z"]);

export const add = (left, right) => left.map((entry, index) => entry + right[index]);
export const subtract = (left, right) => left.map((entry, index) => entry - right[index]);
export const scale = (value, amount) => value.map((entry) => entry * amount);
export const dot = (left, right) => left.reduce((sum, entry, index) => sum + entry * right[index], 0);
export const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];
export const length = (value) => Math.hypot(...value);
export const distance = (left, right) => length(subtract(left, right));
export const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function unit(value, fallback = [1, 0, 0]) {
  const magnitude = length(value);
  if (magnitude > EPSILON) return value.map((entry) => entry / magnitude);
  const fallbackLength = length(fallback);
  if (fallbackLength <= EPSILON) return [1, 0, 0];
  return fallback.map((entry) => entry / fallbackLength);
}

export function canonicalQuaternion(value) {
  const magnitude = length(value);
  if (magnitude <= EPSILON) return [...IDENTITY];
  const normalized = value.map((entry) => entry / magnitude);
  return normalized[3] < 0 ? normalized.map((entry) => -entry) : normalized;
}

export function quaternionMultiply(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return canonicalQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

export const quaternionConjugate = (value) => [-value[0], -value[1], -value[2], value[3]];

function quaternionFromAxisAngle(axisValue, radians) {
  const axis = unit(axisValue, [1, 0, 0]);
  const half = radians / 2;
  const sine = Math.sin(half);
  return canonicalQuaternion([axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)]);
}

export function deterministicOrthogonal(directionValue, handedness = "right") {
  const direction = unit(directionValue, [1, 0, 0]);
  const candidates = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    .sort((left, right) => Math.abs(dot(direction, left)) - Math.abs(dot(direction, right)));
  let result = cross(direction, candidates[0]);
  if (length(result) <= EPSILON) result = cross(direction, candidates[1]);
  result = unit(result, [0, 1, 0]);
  return handedness === "left" ? scale(result, -1) : result;
}

export function quaternionFromTo(fromValue, toValue, handedness = "right") {
  const from = unit(fromValue, [1, 0, 0]);
  const to = unit(toValue, from);
  const cosine = clamp(dot(from, to), -1, 1);
  if (cosine > 1 - 1e-10) return [...IDENTITY];
  if (cosine < -1 + 1e-10) {
    return quaternionFromAxisAngle(deterministicOrthogonal(from, handedness), Math.PI);
  }
  const axis = cross(from, to);
  return canonicalQuaternion([axis[0], axis[1], axis[2], 1 + cosine]);
}

function wrapRadians(value) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function quaternionToEulerXYZ(quaternion) {
  const [x, y, z, w] = canonicalQuaternion(quaternion);
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(clamp(2 * (w * y - z * x), -1, 1)),
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  ].map(wrapRadians);
}

function quaternionFromEulerXYZ([x, y, z]) {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return canonicalQuaternion([
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]);
}

function defaultLimitAxis(document, joint) {
  const ownLength = length(joint.rest.translation);
  if (ownLength > EPSILON) return unit(joint.rest.translation);
  const child = document.joints.find((candidate) => candidate.parent === joint.id
    && length(candidate.rest.translation) > EPSILON);
  if (child) return unit(child.rest.translation);
  const fallback = [0, 0, 0];
  fallback[AXES.indexOf(document.coordinateSystem.up)] = 1;
  return fallback;
}

function clampSwingTwist(document, joint, quaternion) {
  if (joint.limits?.swing === undefined && joint.limits?.twist === undefined) return quaternion;
  const axis = defaultLimitAxis(document, joint);
  const projection = dot(quaternion.slice(0, 3), axis);
  let twist = canonicalQuaternion([
    axis[0] * projection,
    axis[1] * projection,
    axis[2] * projection,
    quaternion[3],
  ]);
  const swing = canonicalQuaternion(quaternionMultiply(quaternion, quaternionConjugate(twist)));
  const swingMagnitude = length(swing.slice(0, 3));
  const swingAngle = 2 * Math.atan2(swingMagnitude, Math.abs(swing[3]));
  let clampedSwing = swing;
  if (joint.limits.swing !== undefined && swingAngle > joint.limits.swing) {
    clampedSwing = quaternionFromAxisAngle(
      swingMagnitude > EPSILON ? swing.slice(0, 3) : deterministicOrthogonal(axis),
      joint.limits.swing,
    );
  }
  let twistAngle = wrapRadians(2 * Math.atan2(dot(twist.slice(0, 3), axis), twist[3]));
  if (joint.limits.twist) {
    twistAngle = clamp(twistAngle, joint.limits.twist[0], joint.limits.twist[1]);
    twist = quaternionFromAxisAngle(axis, twistAngle);
  }
  return quaternionMultiply(clampedSwing, twist);
}

function clampAxes(joint, quaternion) {
  if (!joint.limits?.axes) return quaternion;
  const euler = quaternionToEulerXYZ(quaternion);
  for (const axis of AXES) {
    const limits = joint.limits.axes[axis];
    if (limits) euler[AXES.indexOf(axis)] = clamp(euler[AXES.indexOf(axis)], limits[0], limits[1]);
  }
  return quaternionFromEulerXYZ(euler);
}

export function clampJointRotation(document, joint, quaternion) {
  let result = canonicalQuaternion(quaternion);
  result = clampAxes(joint, result);
  result = clampSwingTwist(document, joint, result);
  result = clampAxes(joint, result);
  return canonicalQuaternion(result);
}

export function estimateTemporaryBytes(chainLength) {
  const positionBuffers = chainLength * 3 * Float64Array.BYTES_PER_ELEMENT * 3;
  const rotationBuffers = chainLength * 4 * Float64Array.BYTES_PER_ELEMENT * 2;
  const segmentLengths = Math.max(0, chainLength - 1) * Float64Array.BYTES_PER_ELEMENT;
  return positionBuffers + rotationBuffers + segmentLengths;
}

export function minimumReach(segmentLengths) {
  if (!segmentLengths.length) return 0;
  const total = segmentLengths.reduce((sum, entry) => sum + entry, 0);
  const longest = Math.max(...segmentLengths);
  return Math.max(0, longest - (total - longest));
}

