import {
  createRigAuthoringState,
  createRiggingSession,
  reduceRigAuthoringEvent,
} from "@greenways/hodos-world-model/rigging";

export const RIGGING_DEMO_EXPERIENCE = "rigging";
export const RIGGING_DEMO_FIXTURE = "./rigging-stylized-unrigged.glb";

export function createRiggingDemoState({
  sessionId = "rig-session:hodos-demo",
  historyLimit = 64,
} = {}) {
  return createRigAuthoringState({
    session: createRiggingSession({ id: sessionId }),
    history: { limit: historyLimit },
  });
}

export function reduceRiggingDemoState(state, event) {
  return reduceRigAuthoringEvent(state, event);
}

export function riggingDemoSummary(stateValue = {}) {
  const state = createRigAuthoringState(stateValue);
  const source = state.session?.active?.source ?? null;
  const outcome = state.lastOutcome ?? null;
  return Object.freeze({
    fileName: source?.fileName ?? "No local GLB",
    contentId: source?.contentId ?? null,
    revision: state.document.revision,
    joints: state.document.joints.length,
    outcome: outcome?.status ?? "ready",
    message: outcome?.status === "rejected"
      ? outcome.error?.message ?? "Rig operation rejected"
      : null,
  });
}
