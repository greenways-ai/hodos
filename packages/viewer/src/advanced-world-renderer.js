import {
  Asset,
  BLEND_NORMAL,
  Color,
  Entity,
  StandardMaterial,
  Vec3,
} from "playcanvas";
import { WorldRenderer } from "./world-renderer.js";
import {
  evaluateAnimation,
  normalizeAdvancedEditor,
  normalizeAuthoringDocument,
  projectedTargetsInRect,
  selectionPivot,
} from "./world-authoring-model.js";
import {
  normalizeWorldEntity,
  normalizeWorldTransform,
  worldEntityRadius,
} from "./world-editor-model.js";

const AXIS_COLORS = Object.freeze(["#e86c6c", "#76cb83", "#6f9fe8"]);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function color(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || "");
  if (!match) return new Color(1, 1, 1);
  const number = Number.parseInt(match[1], 16);
  return new Color(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

function material(value, opacity = 1) {
  const output = new StandardMaterial();
  output.diffuse.copy(color(value));
  output.emissive.copy(color(value));
  output.emissiveIntensity = 0.35;
  output.opacity = opacity;
  if (opacity < 1) {
    output.blendType = BLEND_NORMAL;
    output.depthWrite = false;
  }
  output.update();
  return output;
}

function cloneTransform(value) {
  const transform = normalizeWorldTransform(value);
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function rotatePoint(position, pivot, axis, degrees) {
  const radians = degrees * Math.PI / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const relative = position.map((value, index) => value - pivot[index]);
  let next;
  if (axis === 0) next = [relative[0], relative[1] * cosine - relative[2] * sine, relative[1] * sine + relative[2] * cosine];
  else if (axis === 1) next = [relative[0] * cosine + relative[2] * sine, relative[1], -relative[0] * sine + relative[2] * cosine];
  else next = [relative[0] * cosine - relative[1] * sine, relative[0] * sine + relative[1] * cosine, relative[2]];
  return next.map((value, index) => value + pivot[index]);
}

function snapped(value, step, enabled) {
  return enabled ? Math.round(value / step) * step : value;
}

export class AdvancedWorldRenderer extends WorldRenderer {
  constructor(canvas, options = {}) {
    super(canvas, options);
    this.document = normalizeAuthoringDocument();
    this.editor = normalizeAdvancedEditor();
    this.selectionMode = "replace";
    this.selectionBox = null;
    this.pivotMarker = null;
    this.gizmoVisual = null;
    this.gizmoMaterials = [];
    this.timelineClock = null;
    this.timelineReportedAt = 0;
    this.assetInstances = new Map();
    this.installSelectionModifiers();
    this.installBoxSelection();
    this.installPlaneHandles();
    this.createGeometricGizmo();
    this.createPivotMarker();
  }

  installSelectionModifiers() {
    this.canvas.addEventListener("pointerup", (event) => {
      this.selectionMode = event.shiftKey ? "toggle" : event.metaKey || event.ctrlKey ? "add" : "replace";
    }, { capture: true, signal: this.abort.signal });
  }

  installBoxSelection() {
    const root = this.entityOverlayRoot;
    if (!root) return;
    const document = root.ownerDocument ?? globalThis.document;
    let drag = null;
    const start = (event) => {
      if (event.button !== 0 || this.editor.mode !== "edit" || this.editor.tool !== "box") return;
      const rect = this.canvas.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "hodos-selection-box";
      root.append(box);
      drag = {
        pointer: event.pointerId,
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        box,
        mode: event.shiftKey ? "toggle" : "replace",
      };
      this.canvas.setPointerCapture(event.pointerId);
      this.updateSelectionBox(drag);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const move = (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const rect = this.canvas.getBoundingClientRect();
      drag.x = event.clientX - rect.left;
      drag.y = event.clientY - rect.top;
      this.updateSelectionBox(drag);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const finish = (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const current = drag;
      drag = null;
      current.box.remove();
      const targets = projectedTargetsInRect(this.projectedEditorTargets(), {
        left: current.startX,
        right: current.x,
        top: current.startY,
        bottom: current.y,
      });
      this.onWorldEntity({ action: "box-select", targets, mode: current.mode });
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.canvas.addEventListener("pointerdown", start, { capture: true, signal: this.abort.signal });
    this.canvas.addEventListener("pointermove", move, { capture: true, signal: this.abort.signal });
    this.canvas.addEventListener("pointerup", finish, { capture: true, signal: this.abort.signal });
    this.canvas.addEventListener("pointercancel", finish, { capture: true, signal: this.abort.signal });
  }

  updateSelectionBox(drag) {
    const left = Math.min(drag.startX, drag.x);
    const top = Math.min(drag.startY, drag.y);
    drag.box.style.left = `${left}px`;
    drag.box.style.top = `${top}px`;
    drag.box.style.width = `${Math.abs(drag.x - drag.startX)}px`;
    drag.box.style.height = `${Math.abs(drag.y - drag.startY)}px`;
  }

  projectedEditorTargets() {
    const rect = this.canvas.getBoundingClientRect();
    const width = this.app.graphicsDevice.width || this.canvas.width || rect.width;
    const height = this.app.graphicsDevice.height || this.canvas.height || rect.height;
    const projected = new Vec3();
    const values = [];
    const push = (type, id, anchor, visible = true) => {
      this.camera.camera.worldToScreen(anchor.getPosition(), projected);
      values.push({
        type,
        id,
        x: projected.x / width * rect.width,
        y: projected.y / height * rect.height,
        visible: visible && projected.z > 0,
      });
    };
    for (const entry of this.worldEntities.values()) push("entity", entry.data.id, entry.root, entry.root.enabled);
    for (const entry of this.audioSources.values()) push("audio", entry.source.id, entry.anchor, true);
    return values;
  }

  installPlaneHandles() {
    if (!this.gizmo?.root) return;
    for (const [handle, axes] of [["XY", [0, 1]], ["XZ", [0, 2]], ["YZ", [1, 2]], ["ALL", [0, 1, 2]]]) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "hodos-gizmo-plane";
      control.dataset.plane = handle.toLowerCase();
      control.textContent = handle;
      control.setAttribute("aria-label", `Transform ${handle} axes`);
      this.installGizmoDrag(control, axes);
      this.gizmo.root.append(control);
    }
  }

  createPivotMarker() {
    if (!this.entityOverlayRoot) return;
    const marker = document.createElement("div");
    marker.className = "hodos-editor-pivot-marker";
    marker.hidden = true;
    this.entityOverlayRoot.append(marker);
    this.pivotMarker = { root: marker, anchor: new Entity("Editor pivot"), projected: new Vec3() };
    this.app.root.addChild(this.pivotMarker.anchor);
  }

  createGeometricGizmo() {
    const root = new Entity("Geometric transform gizmo");
    root.enabled = false;
    this.app.root.addChild(root);
    this.gizmoVisual = root;
    const axes = [
      { axis: 0, rotation: [0, 0, -90], position: [0.52, 0, 0] },
      { axis: 1, rotation: [0, 0, 0], position: [0, 0.52, 0] },
      { axis: 2, rotation: [90, 0, 0], position: [0, 0, 0.52] },
    ];
    for (const item of axes) {
      const axisMaterial = material(AXIS_COLORS[item.axis]);
      this.gizmoMaterials.push(axisMaterial);
      const shaft = new Entity(`Gizmo axis ${item.axis}`);
      shaft.addComponent("render", { type: "cylinder", material: axisMaterial });
      shaft.setLocalPosition(...item.position);
      shaft.setLocalEulerAngles(...item.rotation);
      shaft.setLocalScale(0.025, 0.5, 0.025);
      root.addChild(shaft);
      const tip = new Entity(`Gizmo tip ${item.axis}`);
      tip.addComponent("render", { type: "cone", material: axisMaterial });
      const tipPosition = [0, 0, 0];
      tipPosition[item.axis] = 1.05;
      tip.setLocalPosition(...tipPosition);
      tip.setLocalEulerAngles(...item.rotation);
      tip.setLocalScale(0.09, 0.18, 0.09);
      root.addChild(tip);
    }
    for (const [name, position, scale, value] of [
      ["xy", [0.22, 0.22, 0], [0.18, 0.18, 0.015], "#d7c269"],
      ["xz", [0.22, 0, 0.22], [0.18, 0.015, 0.18], "#bf79b9"],
      ["yz", [0, 0.22, 0.22], [0.015, 0.18, 0.18], "#6cbab1"],
    ]) {
      const planeMaterial = material(value, 0.32);
      this.gizmoMaterials.push(planeMaterial);
      const plane = new Entity(`Gizmo plane ${name}`);
      plane.addComponent("render", { type: "box", material: planeMaterial });
      plane.setLocalPosition(...position);
      plane.setLocalScale(...scale);
      root.addChild(plane);
    }
  }

  createWorldEntityEntry(value) {
    const entry = super.createWorldEntityEntry(value);
    this.decorateAdvancedEntity(entry);
    return entry;
  }

  decorateAdvancedEntity(entry) {
    const data = entry.data;
    if (data.kind === "camera" && !entry.root.camera) {
      const camera = data.components.camera ?? {};
      entry.root.addComponent("camera", {
        enabled: false,
        fov: camera.fov ?? 60,
        nearClip: camera.nearClip ?? 0.05,
        farClip: camera.farClip ?? 1000,
      });
      entry.visual.setLocalScale(0.28, 0.18, 0.4);
    } else if (data.kind === "trigger") {
      const trigger = data.components.trigger ?? {};
      entry.material.opacity = 0.18;
      entry.material.blendType = BLEND_NORMAL;
      entry.material.depthWrite = false;
      entry.visual.setLocalScale(...(trigger.size ?? [1, 1, 1]));
      entry.material.update();
    } else if (data.kind === "asset-instance") {
      this.loadAssetInstance(entry).catch((error) => {
        console.warn(`Could not load asset instance ${data.id}`, error);
      });
    }
  }

  async loadAssetInstance(entry) {
    const assetData = entry.data.components.asset ?? {};
    if (!assetData.url || entry.assetUrl === assetData.url) return;
    entry.assetUrl = assetData.url;
    const asset = new Asset(`${entry.data.id} GLB`, "container", { url: assetData.url });
    this.app.assets.add(asset);
    await new Promise((resolve, reject) => {
      asset.once("load", resolve);
      asset.once("error", reject);
      this.app.assets.load(asset);
    });
    if (entry.assetUrl !== assetData.url) return;
    entry.assetEntity?.destroy?.();
    const instance = asset.resource?.instantiateRenderEntity?.();
    if (instance) {
      entry.visual.enabled = false;
      entry.root.addChild(instance);
      entry.assetEntity = instance;
      entry.asset = asset;
      this.assetInstances.set(entry.data.id, asset);
    }
  }

  updateWorldEntityEntry(entry, value) {
    super.updateWorldEntityEntry(entry, value);
    if (entry.data.kind === "camera" && entry.root.camera) {
      const camera = entry.data.components.camera ?? {};
      entry.root.camera.fov = camera.fov ?? 60;
      entry.root.camera.nearClip = camera.nearClip ?? 0.05;
      entry.root.camera.farClip = camera.farClip ?? 1000;
    }
    if (entry.data.kind === "trigger") {
      entry.visual.setLocalScale(...(entry.data.components.trigger?.size ?? [1, 1, 1]));
    }
    if (entry.data.kind === "asset-instance") this.loadAssetInstance(entry).catch(() => {});
  }

  removeWorldEntity(id) {
    const entry = this.worldEntities.get(id);
    entry?.assetEntity?.destroy?.();
    const asset = this.assetInstances.get(id);
    if (asset) {
      this.app.assets.remove(asset);
      asset.unload?.();
      this.assetInstances.delete(id);
    }
    super.removeWorldEntity(id);
  }

  syncEditorDocument(documentValue = {}, editorValue = {}) {
    this.document = normalizeAuthoringDocument(documentValue);
    this.editor = normalizeAdvancedEditor(editorValue);
    this.syncWorldEntities(this.document.entities, this.editor);
    this.syncAudioSources(this.document.audioSources);
    this.applyIsolation();
    this.applyTimeline(this.editor.timeline.time);
    this.updateEditorGizmo();
    this.updateOverlays();
  }

  syncWorldEntities(values = [], editor = this.editor) {
    this.editor = normalizeAdvancedEditor(editor);
    super.syncWorldEntities(values, this.editor);
    this.applyIsolation();
    const selected = new Set(this.editor.selection.filter((target) => target.type === "entity").map((target) => target.id));
    for (const entry of this.worldEntities.values()) this.updateMaterial(entry, selected.has(entry.data.id));
    this.updateGeometricGizmo();
  }

  syncAudioSources(sources = []) {
    super.syncAudioSources(sources);
    const selected = new Set(this.editor.selection.filter((target) => target.type === "audio").map((target) => target.id));
    for (const entry of this.audioSources.values()) {
      if (entry.controls) entry.controls.root.dataset.selected = String(selected.has(entry.source.id));
    }
  }

  applyIsolation() {
    const isolated = this.editor.isolation;
    for (const entry of this.worldEntities.values()) {
      const collection = entry.data.collection ?? null;
      const included = !isolated
        || (isolated === "__root__" ? !collection : collection === isolated);
      entry.root.enabled = entry.data.visible !== false && included;
    }
  }

  activateWorldEntityAt(clientX, clientY) {
    const ray = this.screenRay(clientX, clientY);
    if (!ray) return null;
    let nearest = null;
    const candidates = [];
    for (const entry of this.worldEntities.values()) {
      if (!entry.root.enabled || entry.data.locked) continue;
      candidates.push({ type: "entity", id: entry.data.id, anchor: entry.root, radius: entry.radius });
    }
    for (const entry of this.audioSources.values()) {
      candidates.push({ type: "audio", id: entry.source.id, anchor: entry.anchor, radius: 0.4 });
    }
    for (const candidate of candidates) {
      const center = candidate.anchor.getPosition();
      const offset = center.clone().sub(ray.origin);
      const along = offset.dot(ray.direction);
      if (along < 0) continue;
      const closest = ray.origin.clone().add(ray.direction.clone().mulScalar(along));
      if (center.clone().sub(closest).length() > candidate.radius) continue;
      if (!nearest || along < nearest.distance) nearest = { candidate, distance: along };
    }
    if (!nearest) return null;
    const target = { type: nearest.candidate.type, id: nearest.candidate.id };
    this.onWorldEntity({ action: "select", target, mode: this.selectionMode });
    return target;
  }

  selectedTargets() {
    return this.editor.selection.flatMap((target) => {
      if (target.type === "audio") {
        const entry = this.audioSources.get(target.id);
        return entry ? [{
          type: "audio",
          id: target.id,
          anchor: entry.anchor,
          source: entry.source,
          transform: { position: [...entry.source.position], rotation: [0, 0, 0], scale: [1, 1, 1] },
        }] : [];
      }
      const entry = this.worldEntities.get(target.id);
      return entry ? [{
        type: "entity",
        id: target.id,
        anchor: entry.root,
        entity: entry.data,
        transform: cloneTransform(entry.data.transform),
      }] : [];
    });
  }

  activeEditorTarget() {
    const active = this.editor.active;
    if (!active) return null;
    return this.selectedTargets().find((target) => target.type === active.type && target.id === active.id) ?? null;
  }

  pivotPosition() {
    return selectionPivot(this.document, this.editor);
  }

  previewTargets(items) {
    for (const item of items) {
      if (item.type === "audio") {
        const entry = this.audioSources.get(item.id);
        entry?.anchor.setPosition(...item.position);
      } else {
        const entry = this.worldEntities.get(item.id);
        if (!entry) continue;
        entry.root.setLocalPosition(...item.transform.position);
        entry.root.setLocalEulerAngles(...item.transform.rotation);
        entry.root.setLocalScale(...item.transform.scale);
      }
    }
    this.updateOverlays();
  }

  transformItems(originalTargets, axes, tool, dx, dy, uniform = false) {
    const pivot = this.pivotPosition();
    const snap = this.editor.snap;
    const distanceScale = Math.max(0.001, this.orbit.distance * 0.0022);
    const axisAmounts = new Map();
    if (axes.length === 1) axisAmounts.set(axes[0], (dx - dy) * distanceScale);
    else {
      axisAmounts.set(axes[0], dx * distanceScale);
      axisAmounts.set(axes[1], -dy * distanceScale);
      if (axes.length === 3) axisAmounts.set(2, (dx - dy) * distanceScale * 0.5);
    }
    return originalTargets.flatMap((target) => {
      if (target.type === "audio") {
        if (tool !== "translate") return [];
        const position = [...target.transform.position];
        for (const [axis, amount] of axisAmounts) {
          position[axis] = snapped(position[axis] + amount, snap.translate, snap.enabled);
        }
        return [{ type: "audio", id: target.id, position }];
      }
      if (target.entity.locked) return [];
      const transform = cloneTransform(target.transform);
      if (tool === "translate") {
        for (const [axis, amount] of axisAmounts) {
          transform.position[axis] = snapped(transform.position[axis] + amount, snap.translate, snap.enabled);
        }
      } else if (tool === "rotate") {
        const amount = snapped((dx - dy) * 0.45, snap.rotate, snap.enabled);
        const axis = axes[0];
        transform.rotation[axis] = snapped(transform.rotation[axis] + amount, snap.rotate, snap.enabled);
        if (this.editor.pivot !== "individual") transform.position = rotatePoint(transform.position, pivot, axis, amount);
      } else if (tool === "scale") {
        const factor = Math.max(0.01, 1 + (dx - dy) * 0.01);
        const scaleAxes = uniform || axes.length === 3 ? [0, 1, 2] : axes;
        for (const axis of scaleAxes) {
          transform.scale[axis] = Math.max(0.01, snapped(transform.scale[axis] * factor, snap.scale, snap.enabled));
          if (this.editor.pivot !== "individual") {
            transform.position[axis] = pivot[axis] + (transform.position[axis] - pivot[axis]) * factor;
          }
        }
      }
      return [{ type: "entity", id: target.id, transform }];
    });
  }

  installGizmoDrag(control, axisOrAxes) {
    const axes = Array.isArray(axisOrAxes) ? axisOrAxes : [axisOrAxes];
    let drag = null;
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.editor.mode !== "edit") return;
      const targets = this.selectedTargets();
      if (!targets.length) return;
      control.setPointerCapture(event.pointerId);
      drag = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        targets: targets.map((target) => ({ ...target, transform: cloneTransform(target.transform) })),
        next: [],
      };
      event.preventDefault();
      event.stopPropagation();
    });
    control.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const tool = drag.targets.every((target) => target.type === "audio") ? "translate" : this.editor.tool;
      drag.next = this.transformItems(
        drag.targets,
        axes,
        tool,
        event.clientX - drag.x,
        event.clientY - drag.y,
        control.dataset.plane === "all",
      );
      this.previewTargets(drag.next);
    });
    const finish = (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const items = drag.next;
      drag = null;
      if (items.length) this.onWorldEntity({ action: "transform-selection", items });
    };
    control.addEventListener("pointerup", finish);
    control.addEventListener("pointercancel", () => {
      if (drag) this.previewTargets(drag.targets.map((target) => target.type === "audio"
        ? { type: "audio", id: target.id, position: target.transform.position }
        : { type: "entity", id: target.id, transform: target.transform }));
      drag = null;
    });
  }

  updateEditorGizmo() {
    if (!this.gizmo) return;
    const targets = this.selectedTargets();
    const visible = this.editor.mode === "edit" && targets.length > 0 && !["select", "box"].includes(this.editor.tool);
    this.gizmo.root.hidden = !visible;
    if (!visible) {
      if (this.gizmoVisual) this.gizmoVisual.enabled = false;
      if (this.pivotMarker) this.pivotMarker.root.hidden = true;
      return;
    }
    this.gizmo.root.dataset.tool = targets.every((target) => target.type === "audio") ? "translate" : this.editor.tool;
    this.gizmo.root.dataset.audio = String(targets.every((target) => target.type === "audio"));
    for (const plane of this.gizmo.root.querySelectorAll(".hodos-gizmo-plane")) {
      plane.hidden = this.editor.tool === "rotate";
    }
    this.updateGeometricGizmo();
  }

  updateGeometricGizmo() {
    if (!this.gizmoVisual || !this.pivotMarker) return;
    const visible = this.editor.mode === "edit" && this.editor.selection.length > 0 && !["select", "box"].includes(this.editor.tool);
    this.gizmoVisual.enabled = visible;
    this.pivotMarker.root.hidden = !visible;
    if (!visible) return;
    const pivot = this.pivotPosition();
    this.gizmoVisual.setPosition(...pivot);
    this.pivotMarker.anchor.setPosition(...pivot);
    const target = this.activeEditorTarget();
    if (this.editor.space === "local" && target?.type === "entity") {
      this.gizmoVisual.setEulerAngles(...target.transform.rotation);
    } else {
      this.gizmoVisual.setEulerAngles(0, 0, 0);
    }
    const scale = Math.max(0.25, this.orbit.distance * 0.08);
    this.gizmoVisual.setLocalScale(scale, scale, scale);
  }

  applyTimeline(time) {
    const timeline = this.editor.timeline;
    const animation = this.document.animations.find((entry) => entry.id === timeline.animation)
      ?? this.document.animations[0];
    if (!animation) return;
    for (const value of evaluateAnimation(animation, time)) {
      const entry = this.worldEntities.get(value.entity);
      if (!entry) continue;
      if (value.property === "position") entry.root.setLocalPosition(...value.value);
      else if (value.property === "rotation") entry.root.setLocalEulerAngles(...value.value);
      else if (value.property === "scale") entry.root.setLocalScale(...value.value);
      else if (value.property === "visible") entry.root.enabled = Boolean(value.value);
      else if (value.property === "light.intensity" && entry.root.light) entry.root.light.intensity = finite(value.value, 1);
    }
  }

  updateTimeline(deltaTime = 0) {
    const timeline = this.editor.timeline;
    if (!timeline.playing) {
      this.timelineClock = null;
      return;
    }
    const animation = this.document.animations.find((entry) => entry.id === timeline.animation)
      ?? this.document.animations[0];
    if (!animation) return;
    if (this.timelineClock === null) this.timelineClock = timeline.time;
    this.timelineClock += deltaTime;
    let playing = true;
    if (this.timelineClock > animation.duration) {
      if (timeline.loop) this.timelineClock %= animation.duration;
      else {
        this.timelineClock = animation.duration;
        playing = false;
      }
    }
    this.applyTimeline(this.timelineClock);
    const now = performance.now();
    if (!playing || now - this.timelineReportedAt > 250) {
      this.timelineReportedAt = now;
      this.onWorldEntity({ action: "timeline", time: this.timelineClock, playing });
    }
  }

  updateOverlays(deltaTime) {
    super.updateOverlays();
    this.updateTimeline(deltaTime ?? 0);
    this.updateGeometricGizmo();
    if (this.pivotMarker && !this.pivotMarker.root.hidden) {
      this.projectOverlay(this.pivotMarker, this.pivotMarker.root, 80, 80);
    }
  }

  focusEditorSelection() {
    const targets = this.selectedTargets();
    if (!targets.length) return;
    const positions = targets.map((target) => target.anchor.getPosition());
    const center = new Vec3(
      positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
      positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
      positions.reduce((sum, position) => sum + position.z, 0) / positions.length,
    );
    let radius = 0.4;
    for (const target of targets) {
      const targetRadius = target.type === "entity" ? worldEntityRadius(target.entity) : 0.4;
      radius = Math.max(radius, center.distance(target.anchor.getPosition()) + targetRadius);
    }
    this.orbit.target.copy(center);
    this.orbit.distance = Math.max(radius * 4, 1.5);
    this.updateCamera();
  }

  destroy() {
    this.selectionBox?.remove?.();
    this.pivotMarker?.root.remove();
    this.pivotMarker?.anchor.destroy();
    this.gizmoVisual?.destroy();
    for (const value of this.gizmoMaterials) value.destroy?.();
    super.destroy();
  }
}
