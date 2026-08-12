import {
  RIG_POSE_SCHEMA,
  normalizeRigPose,
} from "./rigging-pose-core.js";

export * from "./rigging-pose-core.js";

export function createRigPose({
  id,
  rigId,
  rigRevision = 0,
  name,
  description,
  joints = [],
  metadata,
} = {}) {
  const pose = {
    schema: RIG_POSE_SCHEMA,
    id,
    revision: 0,
    rigId,
    rigRevision,
    joints,
  };
  if (name !== undefined) pose.name = name;
  if (description !== undefined) pose.description = description;
  if (metadata !== undefined) pose.metadata = metadata;
  return normalizeRigPose(pose);
}
