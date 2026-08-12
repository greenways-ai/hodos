import {
  clonePortable,
  requiredString,
} from "./rigging-values.js";
import { normalizeRigDocument } from "./rigging-validation.js";
import {
  normalizeRigPose,
  validateRigPoseSuiteForRig,
} from "./rigging-pose.js";
import {
  RIG_IK_ACCEPTANCE_SCHEMA,
  RigIkValidationError,
  normalizeRigIkProposal,
} from "./rigging-ik-values.js";

export * from "./rigging-ik-values.js";

export function resolveRigIkChain(documentValue, suiteValue, chainIdValue) {
  const document = normalizeRigDocument(documentValue);
  const suite = validateRigPoseSuiteForRig(document, suiteValue);
  const chainId = requiredString(chainIdValue, "chainId");
  const chain = suite.chains.find((entry) => entry.id === chainId);
  if (!chain) throw new RigIkValidationError(`Unknown Rig IK chain: ${chainId}`);
  return clonePortable(chain);
}

function acceptanceOutcome({ proposal, document, pose, status, nextPose = pose, message = null }) {
  return {
    schema: RIG_IK_ACCEPTANCE_SCHEMA,
    requestId: proposal.requestId,
    providerId: proposal.providerId,
    providerVersion: proposal.providerVersion,
    status,
    rigId: document.id,
    rigRevision: document.revision,
    poseId: pose.id,
    poseRevisionBefore: pose.revision,
    poseRevisionAfter: nextPose.revision,
    error: message ? { code: "rig-ik/proposal-rejected", message } : null,
  };
}

export function applyRigIkProposal(documentValue, poseValue, proposalValue) {
  const document = normalizeRigDocument(documentValue);
  const pose = normalizeRigPose(poseValue);
  const proposal = normalizeRigIkProposal(proposalValue);
  const reject = (message) => ({
    ok: false,
    pose,
    outcome: acceptanceOutcome({ proposal, document, pose, status: "rejected", message }),
  });
  if (pose.rigId !== document.id || pose.rigRevision !== document.revision) {
    return reject(`Stale base pose for rig ${document.id}@${document.revision}`);
  }
  if (proposal.rigId !== document.id || proposal.rigRevision !== document.revision) {
    return reject(`Proposal targets stale rig ${proposal.rigId}@${proposal.rigRevision}`);
  }
  if (proposal.poseId !== pose.id || proposal.basePoseRevision !== pose.revision) {
    return reject(`Proposal targets stale pose ${proposal.poseId}@${proposal.basePoseRevision}`);
  }
  const known = new Set(document.joints.map((joint) => joint.id));
  for (const patch of proposal.joints) {
    if (!known.has(patch.jointId)) return reject(`Proposal references unknown joint: ${patch.jointId}`);
  }
  const patchById = new Map(proposal.joints.map((entry) => [entry.jointId, entry]));
  const currentById = new Map(pose.joints.map((entry) => [entry.jointId, entry]));
  const joints = pose.joints.filter((entry) => !patchById.has(entry.jointId));
  for (const patch of proposal.joints) {
    const current = currentById.get(patch.jointId);
    joints.push({
      jointId: patch.jointId,
      translation: current?.translation ?? null,
      rotation: patch.rotation,
    });
  }
  const nextPose = normalizeRigPose({ ...pose, revision: pose.revision + 1, joints });
  return {
    ok: true,
    pose: nextPose,
    outcome: acceptanceOutcome({ proposal, document, pose, status: "applied", nextPose }),
  };
}
