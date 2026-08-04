import "./studio-clip-edit.css";
import {
  duplicateClip,
  splitClip,
  STUDIO_MIN_CLIP_SECONDS,
  trimClipEnd,
  trimClipStart,
} from "./studio-clip-model.js";
import { normalizeProject } from "./studio-export.js";
import { installHodosWorldDrag } from "@greenways/hodos-world-model/drag";

const PIXELS_PER_SECOND = 42;
const SNAP_SECONDS = 0.25;
const randomId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const snap = (value) => Math.round(value / SNAP_SECONDS) * SNAP_SECONDS;

function assetDuration(project, clip) {
  const asset = (project.assets ?? []).find((entry) => entry.id === clip.asset);
  return Math.max(0, Number(asset?.duration || clip.sourceStartSeconds + clip.duration || 0));
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

function passiveTool(document, label, title, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.className = className;
  button.addEventListener("click", (event) => event.preventDefault());
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

function laneAt(document, x, y) {
  return document.elementFromPoint?.(x, y)?.closest?.(".studio-lane[data-track-id]") ?? null;
}

function installCrossTrackDrag(element, grip, clip, context) {
  let drag = null;
  const clearTarget = () => {
    if (drag?.lane) delete drag.lane.dataset.clipTarget;
  };
  const restore = () => {
    if (!drag) return;
    clearTarget();
    drag.parent.append(element);
    preview(element, clip);
    delete element.dataset.crossTrack;
    drag = null;
  };

  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    grip.setPointerCapture(event.pointerId);
    drag = {
      pointer: event.pointerId,
      parent: element.parentElement,
      lane: element.parentElement,
      track: element.parentElement?.dataset.trackId,
      startSeconds: Number(clip.startSeconds || 0),
    };
    if (drag.lane) drag.lane.dataset.clipTarget = "true";
    element.dataset.crossTrack = "true";
    event.preventDefault();
  });

  grip.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const lane = laneAt(element.ownerDocument, event.clientX, event.clientY);
    if (!lane) return;
    if (drag.lane !== lane) {
      clearTarget();
      drag.lane = lane;
      drag.track = lane.dataset.trackId;
      lane.dataset.clipTarget = "true";
      lane.append(element);
    }
    const rect = lane.getBoundingClientRect();
    drag.startSeconds = snap(Math.max(0, (event.clientX - rect.left) / PIXELS_PER_SECOND));
    preview(element, { ...clip, startSeconds: drag.startSeconds });
  });

  grip.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const target = drag.track;
    const startSeconds = drag.startSeconds;
    clearTarget();
    delete element.dataset.crossTrack;
    drag = null;
    context.dispatch({
      "event/type": "studio/clip-move-track",
      clip: clip.id,
      track: target,
      startSeconds,
    });
  });
  grip.addEventListener("pointercancel", restore);
}

function worldPayload(track, clip) {
  return {
    type: "studio/clip",
    id: randomId("world-audio"),
    track: track.id,
    clip: clip.id,
    label: `${track.name} clip`,
    loop: true,
  };
}

function decorateClip(element, clip, track, project, context) {
  element.dataset.clipId = clip.id;
  element.setAttribute("role", "group");
  element.setAttribute("aria-roledescription", "audio clip");
  const document = element.ownerDocument;
  const start = handle(document, "start", `Trim start of ${clip.id}`);
  const end = handle(document, "end", `Trim end of ${clip.id}`);
  installTrimHandle(element, start, clip, "start", project, context.dispatch);
  installTrimHandle(element, end, clip, "end", project, context.dispatch);

  const tools = document.createElement("div");
  tools.className = "studio-clip-tools";
  const moveTrack = passiveTool(document, "↕", `Move ${clip.id} to another track`, "studio-clip-track-move");
  installCrossTrackDrag(element, moveTrack, clip, context);

  const world = passiveTool(document, "W", `Drag ${clip.id} into the 3D world`, "studio-clip-world");
  world.addEventListener("pointerdown", (event) => event.stopPropagation());
  installHodosWorldDrag(world, context.root, () => worldPayload(track, clip));

  tools.append(
    moveTrack,
    world,
    actionButton(document, "S", `Split ${clip.id} at its midpoint`, () => {
      if (Number(clip.duration || 0) < STUDIO_MIN_CLIP_SECONDS * 2) return;
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
        const rows = [...context.root.querySelectorAll(".studio-track")];
        for (const [trackIndex, track] of (project.tracks ?? []).entries()) {
          const lane = rows[trackIndex]?.querySelector(".studio-lane");
          if (lane) lane.dataset.trackId = track.id;
          const elements = [...(lane?.querySelectorAll(".studio-clip") ?? [])];
          for (const [clipIndex, clip] of (track.clips ?? []).entries()) {
            const element = elements[clipIndex];
            if (element) decorateClip(element, clip, track, project, context);
          }
        }
      },
      destroy() {
        controller.destroy?.();
      },
    };
  };
}
