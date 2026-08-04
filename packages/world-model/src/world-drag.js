export const HODOS_WORLD_DRAG_TYPE = "application/x-hodos-world-payload";
const MAX_WORLD_DRAG_BYTES = 64 * 1024;

function serializedPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Hodos world drag payload must be an object");
  }
  if (typeof payload.type !== "string" || !payload.type.trim()) {
    throw new Error("Hodos world drag payload requires a type");
  }
  const value = JSON.stringify(payload);
  if (new TextEncoder().encode(value).byteLength > MAX_WORLD_DRAG_BYTES) {
    throw new Error("Hodos world drag payload is too large");
  }
  return value;
}

export function writeHodosWorldDrag(dataTransfer, payload) {
  if (!dataTransfer?.setData) throw new Error("World drag requires a DataTransfer object");
  dataTransfer.setData(HODOS_WORLD_DRAG_TYPE, serializedPayload(payload));
  dataTransfer.effectAllowed = "copy";
  return payload;
}

export function hasHodosWorldDrag(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes(HODOS_WORLD_DRAG_TYPE);
}

export function readHodosWorldDrag(dataTransfer) {
  if (!dataTransfer?.getData) throw new Error("World drop requires a DataTransfer object");
  const source = dataTransfer.getData(HODOS_WORLD_DRAG_TYPE);
  if (!source) throw new Error("World drop does not contain a Hodos payload");
  if (new TextEncoder().encode(source).byteLength > MAX_WORLD_DRAG_BYTES) {
    throw new Error("Hodos world drag payload is too large");
  }
  let payload;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw new Error(`Hodos world drag payload is invalid JSON: ${error.message}`);
  }
  serializedPayload(payload);
  return payload;
}

export function setWorldDragPresentation(root, active) {
  const layer = root?.closest?.(".hodos-surface-layer");
  if (!layer) return;
  if (active) layer.dataset.worldDragging = "true";
  else delete layer.dataset.worldDragging;
}

export function installHodosWorldDrag(element, root, payloadFactory) {
  if (!element) throw new Error("World drag requires an element");
  if (typeof payloadFactory !== "function") throw new Error("World drag requires a payload factory");
  element.draggable = true;
  const clear = () => setWorldDragPresentation(root, false);
  element.addEventListener("dragstart", (event) => {
    writeHodosWorldDrag(event.dataTransfer, payloadFactory());
    setWorldDragPresentation(root, true);
    root?.ownerDocument?.addEventListener("drop", clear, { capture: true, once: true });
  });
  element.addEventListener("dragend", clear);
  return element;
}
