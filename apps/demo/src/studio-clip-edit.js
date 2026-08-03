import "./studio-clip-edit.css";
import { normalizeProject } from "./studio-export.js";

const PIXELS_PER_SECOND = 42;
const SNAP_SECONDS = 0.25;
const MIN_CLIP_SECONDS = 0.25;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const snap = (value) => Math.round(value / SNAP_SECONDS) * SNAP_SECONDS;
const randomId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function assetDuration(project, clip) {
  const asset = (project.assets ?? []).find((entry) => entry.id === clip.asset);
  return Math.max(0, Number(asset?.duration || clip.sourceStartSeconds + clip.duration || 0));
}

export function trimClipStart(clip, deltaSeconds) {
  const start = Math.max(0, Number(clip.startSeconds || 0));
  const sourceStart = Math.max(0, Number(clip.sourceStartSeconds || 0));
  const duration = Math.max(MIN_CLIP_SECONDS, Number(clip.duration || MIN_CLIP_SECONDS));
  const delta = snap(clamp(
    Number(deltaSeconds || 0),
    -Math.min(start, sourceStart),
    duration - MIN_CLIP_SECONDS,
  ));
  return {
    ...clip,
    startSeconds: Math.max(0, start + delta),
    sourceStartSeconds: Math.max(0, sourceStart + delta),
    duration: Math.max(MIN_CLIP_SECONDS, duration - delta),
  };
}

export function trimClipEnd(clip, deltaSeconds, maximumSourceDuration) {
  const sourceStart = Math.max(0, Number(clip.sourceStartSeconds || 0));
  const duration = Math.max(MIN_CLIP_SECONDS, Number(clip.duration || MIN_CLIP_SECONDS));
  const maximum = Math.max(MIN_CLIP_SECONDS, Number(maximumSourceDuration || 0) - sourceStart);
  return {
    ...clip,
    duration: snap(clamp(duration + Number(deltaSeconds || 0), MIN_CLIP_SECONDS, maximum)),
  };
}

export function splitClip(clip, {
  offsetSeconds = Number(clip.duration || 0) / 2,
  rightId = randomId("clip"),
} = {}) {
  const duration = Math.max(MIN_CLIP_SECONDS * 2, Number(clip.duration || MIN_CLIP_SECONDS * 2));
  const offset = snap(clamp(offsetSeconds, MIN_CLIP_SECONDS, duration - MIN_CLIP_SECONDS));
  return {
    left: { ...clip, duration: offset },
    right: {
      ...clip,
      id: rightId,
      startSeconds: Number(clip.startSeconds || 0) + offset,
      sourceStartSeconds: Number(clip.sourceStartSeconds || 0) + offset,
      duration: duration - offset,
    },
  };
}

export function duplicateClip(clip, {
  id = randomId("clip"),
  gapSeconds = SNAP_SECONDS,
} = {}) {
  return {
    ...clip,
    id,
    startSeconds: Number(clip.startSeconds || 0) + Number(clip.duration || 0) + gapSeconds,
  };
}

function actionButton(document, label, title, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return button;
}

function handle(document, side, title) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `studio-clip-handle studio-clip-handle--${side}`;
  element.title = title;
  element.setAttribute("aria-label", title);
  return element;
}

function preview(element, clip) {
  element.style.left = `${Number(clip.startSeconds || 0) * PIXELS_PER_SECOND}px`;
  element.style.width = `${Math.max(72, Number(clip.duration || 0) * PIXELS_PER_SECOND)}px`;
  element.dataset.start = `${Number(clip.startSeconds || 0).toFixed(2)}s`;
}

function installTrimHandle(element, grip, clip, side, project, dispatch) {
  let drag = null;
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    grip.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, x: event.clientX, next: clip };
    element.dataset.trimming = side;
    event.preventDefault();
  });
  grip.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const delta = (event.clientX - drag.x) / PIXELS_PER_SECOND;
    drag.next = side === "start"
      ? trimClipStart(clip, delta)
      : trimClipEnd(clip, delta, assetDuration(project, clip));
    preview(element, drag.next);
  });
  const finish = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const next = drag.next;
    drag = null;
    delete element.dataset.trimming;
    dispatch({ "event/type": "studio/clip-replace", clip: next });
  };
  grip.addEventListener("pointerup", finish);
  grip.addEventListener("pointercancel", () => {
    if (drag) preview(element, clip);
    drag = null;
    delete element.dataset.trimming;
  });
}

function decorateClip(element, clip, project, context) {
  element.dataset.clipId = clip.id;
  const document = element.ownerDocument;
  const start = handle(document, "start", `Trim start of ${clip.id}`);
  const end = handle(document, "end", `Trim end of ${clip.id}`);
  installTrimHandle(element, start, clip, "start", project, context.dispatch);
  installTrimHandle(element, end, clip, "end", project, context.dispatch);

  const tools = document.createElement("div");
  tools.className = "studio-clip-tools";
  tools.append(
    actionButton(document, "S", `Split ${clip.id} at its midpoint`, () => {
      if (Number(clip.duration || 0) < MIN_CLIP_SECONDS * 2) return;
      const parts = splitClip(clip);
      context.dispatch({
        "event/type": "studio/clip-split",
        target: clip.id,
        left: parts.left,
        right: parts.right,
      });
    }),
    actionButton(document, "D", `Duplicate ${clip.id}`, () => {
      context.dispatch({
        "event/type": "studio/clip-insert-after",
        target: clip.id,
        clip: duplicateClip(clip),
      });
    }),
    actionButton(document, "×", `Delete ${clip.id}`, () => {
      context.dispatch({ "event/type": "studio/clip-delete", clip: clip.id });
    }),
  );

  element.append(start, end, tools);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      context.dispatch({ "event/type": "studio/clip-delete", clip: clip.id });
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      context.dispatch({
        "event/type": "studio/clip-insert-after",
        target: clip.id,
        clip: duplicateClip(clip),
      });
    }
  });
}

export function withStudioClipEditing(factory) {
  if (typeof factory !== "function") throw new Error("Studio clip editing requires a surface factory");
  return (context) => {
    const controller = factory(context) ?? {};
    return {
      ...controller,
      update(state) {
        controller.update?.(state);
        const project = normalizeProject(state?.studio?.project ?? { id: "local/current", assets: [], tracks: [] });
        const elements = [...context.root.querySelectorAll(".studio-clip")];
        let index = 0;
        for (const track of project.tracks ?? []) {
          for (const clip of track.clips ?? []) {
            const element = elements[index];
            if (element) decorateClip(element, clip, project, context);
            index += 1;
          }
        }
      },
      destroy() {
        controller.destroy?.();
      },
    };
  };
}
