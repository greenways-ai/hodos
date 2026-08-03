import "./studio-track-management.css";
import { normalizeProject } from "./studio-export.js";
import { installHodosWorldDrag } from "../../../packages/viewer/src/world-drag.js";

const randomId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function newTrack(project) {
  const number = (project?.tracks?.length ?? 0) + 1;
  return {
    id: randomId("track"),
    name: `Audio ${number}`,
    gainDb: 0,
    pan: 0,
    mute: false,
    clips: [],
  };
}

function worldPayload(track) {
  return {
    type: "studio/track",
    id: randomId("world-audio"),
    track: track.id,
    label: track.name,
    loop: true,
  };
}

export function withStudioTrackManagement(factory) {
  if (typeof factory !== "function") throw new Error("Studio track management requires a surface factory");
  return (context) => {
    const controller = factory(context) ?? {};
    let project = { id: "local/current", assets: [], tracks: [] };
    const actions = context.root.querySelector("[data-actions]");
    if (actions) {
      const create = context.root.ownerDocument.createElement("button");
      create.type = "button";
      create.className = "studio-new-track";
      create.textContent = "New track";
      create.addEventListener("click", () => context.dispatch({
        "event/type": "studio/track-create",
        track: newTrack(project),
      }));
      actions.prepend(create);
    }

    return {
      ...controller,
      update(state) {
        controller.update?.(state);
        project = normalizeProject(state?.studio?.project ?? project);
        const rows = [...context.root.querySelectorAll(".studio-track")];
        for (const [index, track] of (project.tracks ?? []).entries()) {
          const row = rows[index];
          if (!row) continue;
          const header = row.querySelector("header");
          const lane = row.querySelector(".studio-lane");
          if (lane) {
            lane.dataset.trackId = track.id;
            if (!(track.clips ?? []).length) {
              const empty = context.root.ownerDocument.createElement("span");
              empty.className = "studio-empty-lane";
              empty.textContent = "Empty track — move or import a clip here";
              lane.append(empty);
            }
          }
          if (!header) continue;
          header.dataset.worldDraggable = "true";
          const controls = header.querySelector(".studio-track-controls") ?? header;
          const world = context.root.ownerDocument.createElement("button");
          world.type = "button";
          world.className = "studio-track-world";
          world.textContent = "World";
          world.title = `Drag ${track.name} into the 3D world`;
          world.setAttribute("aria-label", `Drag ${track.name} into the 3D world`);
          world.addEventListener("click", (event) => event.preventDefault());
          installHodosWorldDrag(world, context.root, () => worldPayload(track));
          controls.append(world);
        }
      },
      destroy() {
        controller.destroy?.();
      },
    };
  };
}
