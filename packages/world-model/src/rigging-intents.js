import {
  MAX_OPERATION_ID_LENGTH,
  MAX_PORTABLE_ISSUES,
  RIG_EVIDENCE_SCHEMA,
  RIG_INTENT_SCHEMA,
  RIG_INTENT_TYPES,
  RIG_OUTCOME_SCHEMA,
  clonePortable,
  isPlainObject,
  portableIssues,
  requiredString,
} from "./rigging-values.js";
import {
  addRigJoint,
  attachRigSkin,
  deleteRigJoint,
  duplicateRigJoints,
  mirrorRigJoints,
  renameRigJoint,
  reparentRigJoint,
  rigMetrics,
  updateRigJoint,
} from "./rigging-document.js";
import {
  RigValidationError,
  normalizeRigDocument,
  validateRigDocument,
} from "./rigging-validation.js";

function operationId(document, intent) {
  const fallback = `${document.id}:${document.revision + 1}:${intent.type ?? "unknown"}`;
  const value = intent.id === undefined ? fallback : requiredString(intent.id, "intent.id");
  return value.slice(0, MAX_OPERATION_ID_LENGTH);
}

function evidenceFor(document, { id, type, status, validation, error = null }) {
  const metrics = rigMetrics(document);
  const issues = [
    ...(validation?.errors ?? []),
    ...(validation?.warnings ?? []),
  ].slice(0, MAX_PORTABLE_ISSUES).map((entry) => ({ ...entry }));
  return {
    schema: RIG_EVIDENCE_SCHEMA,
    runId: id,
    rigId: document.id,
    revision: document.revision,
    operation: type,
    status,
    metrics: { ...metrics, issueCount: issues.length },
    issues,
    truncated: Boolean(validation?.truncated || (validation?.errors?.length ?? 0) + (validation?.warnings?.length ?? 0) > MAX_PORTABLE_ISSUES),
    error,
  };
}

function outcomeFor({ id, type, status, before, after, sequence = null, error = null }) {
  return {
    schema: RIG_OUTCOME_SCHEMA,
    operationId: id,
    type,
    status,
    sequence,
    revisionBefore: before,
    revisionAfter: after,
    error,
  };
}

export function applyRigIntent(documentValue, intentValue = {}) {
  const document = normalizeRigDocument(documentValue);
  let intent;
  try {
    const problems = portableIssues(intentValue);
    if (problems.length) throw new RigValidationError("Rig intent contains non-portable values", problems);
    if (!isPlainObject(intentValue)) throw new TypeError("Rig intent must be an object");
    intent = clonePortable(intentValue);
    intent.type = requiredString(intent.type, "intent.type");
    if (intent.schema !== undefined && intent.schema !== RIG_INTENT_SCHEMA) {
      throw new TypeError(`intent.schema must be ${RIG_INTENT_SCHEMA}`);
    }
    if (!RIG_INTENT_TYPES.includes(intent.type)) throw new TypeError(`Unsupported rig intent: ${intent.type}`);
    if (intent.expectedRevision !== undefined && intent.expectedRevision !== document.revision) {
      throw new RangeError(`Stale rig revision: expected ${intent.expectedRevision}, current ${document.revision}`);
    }
    if (intent.sequence !== undefined && (!Number.isSafeInteger(intent.sequence) || intent.sequence < 0)) {
      throw new TypeError("intent.sequence must be a non-negative safe integer");
    }
    const id = operationId(document, intent);
    let next;
    switch (intent.type) {
      case "rig/joint-create":
        next = addRigJoint(document, intent.joint);
        break;
      case "rig/joint-update":
        next = updateRigJoint(document, intent.jointId, intent.patch);
        break;
      case "rig/joint-rename":
        next = renameRigJoint(document, intent.jointId, intent.nextId);
        break;
      case "rig/joint-reparent":
        next = reparentRigJoint(document, intent.jointId, intent.parentId ?? null);
        break;
      case "rig/joint-delete":
        next = deleteRigJoint(document, intent.jointId, { cascade: Boolean(intent.cascade) });
        break;
      case "rig/joint-duplicate":
        next = duplicateRigJoints(document, { jointIds: intent.jointIds, idMap: intent.idMap, offset: intent.offset });
        break;
      case "rig/joint-mirror":
        next = mirrorRigJoints(document, { jointIds: intent.jointIds, idMap: intent.idMap, axis: intent.axis });
        break;
      case "rig/skin-attach":
        next = attachRigSkin(document, intent.skin, intent.bind);
        break;
      default:
        throw new TypeError(`Unsupported rig intent: ${intent.type}`);
    }
    const validation = validateRigDocument(next);
    return {
      ok: true,
      document: next,
      outcome: outcomeFor({
        id,
        type: intent.type,
        status: "applied",
        before: document.revision,
        after: next.revision,
        sequence: intent.sequence ?? null,
      }),
      evidence: evidenceFor(next, { id, type: intent.type, status: validation.warnings.length ? "warn" : "pass", validation }),
    };
  } catch (error) {
    const type = typeof intentValue?.type === "string" ? intentValue.type : "rig/unknown";
    const id = (() => {
      try { return operationId(document, isPlainObject(intentValue) ? intentValue : { type }); }
      catch { return `${document.id}:${document.revision + 1}:${type}`.slice(0, MAX_OPERATION_ID_LENGTH); }
    })();
    const portableError = {
      code: error instanceof RigValidationError ? "rig/validation-error" : "rig/intent-rejected",
      message: String(error.message || error).slice(0, 512),
    };
    const validation = validateRigDocument(document);
    return {
      ok: false,
      document,
      outcome: outcomeFor({
        id,
        type,
        status: "rejected",
        before: document.revision,
        after: document.revision,
        sequence: Number.isSafeInteger(intentValue?.sequence) ? intentValue.sequence : null,
        error: portableError,
      }),
      evidence: evidenceFor(document, { id, type, status: "fail", validation, error: portableError }),
    };
  }
}
