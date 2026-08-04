import {
  Application,
  Asset,
  BLEND_NORMAL,
  BoundingBox,
  Color,
  Entity,
  FILLMODE_FILL_WINDOW,
  GSPLAT_RENDERER_AUTO,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from "playcanvas";
import { hasHodosWorldDrag, readHodosWorldDrag } from "./world-drag.js";
import {
  editorState,
  normalizeWorldEntity,
  normalizeWorldTransform,
  worldEntityRadius,
} from "./world-editor-model.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const AXES = Object.freeze(["x", "y", "z"]);

function hexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || "");
  if (!match) return new Color(0.035, 0.047, 0.063);
  const number = Number.parseInt(match[1], 16);
  return new Color(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

function addTransform(parent, transform, name) {
  const entity = new Entity(name);
  const { position, rotation, scale } = transform;
  entity.setLocalPosition(...position);
  entity.setLocalEulerAngles(...rotation);
  entity.setLocalScale(scale, scale, scale);
  parent.addChild(entity);
  return entity;
}

function sourcePosition(source) {
  const value = source?.position;
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value
    : [0, 0, 0];
}

function primitiveType(kind) {
  return ["box", "sphere", "plane", "cylinder", "cone", "capsule"].includes(kind)
    ? kind
    : "sphere";
}

function cloneTransform(value) {
  const transform = normalizeWorldTransform(value);
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

export class WorldRenderer {
  constructor(canvas, {
    background = "#09101a",
    camera,
    onLayer,
    onTouchpoint,
    touchpointRoot,
    onWorldDrop,
    onAudioSource,
    audioSourceRoot,
    entityOverlayRoot,
    onWorldEntity,
    onCameraChange,
  } = {}) {
    this.canvas = canvas;
    this.onLayer = onLayer || (() => {});
    this.onTouchpoint = onTouchpoint || (() => {});
    this.onWorldDrop = onWorldDrop || (() => {});
    this.onAudioSource = onAudioSource || (() => {});
    this.onWorldEntity = onWorldEntity || (() => {});
    this.onCameraChange = onCameraChange || (() => {});
    this.touchpointRoot = touchpointRoot;
    this.audioSourceRoot = audioSourceRoot;
    this.entityOverlayRoot = entityOverlayRoot;
    this.assets = new Map();
    this.entities = [];
    this.touchpoints = [];
    this.audioSources = new Map();
    this.worldEntities = new Map();
    this.editor = editorState();
    this.bounds = null;
    this.destroyed = false;
    this.abort = new AbortController();
    this.gizmo = null;

    this.app = new Application(canvas, {
      graphicsDeviceOptions: { antialias: false, alpha: false, powerPreference: "high-performance" },
    });
    this.app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(RESOLUTION_AUTO, 1);
    this.app.scene.gsplat.renderer = GSPLAT_RENDERER_AUTO;
    this.app.scene.ambientLight = hexColor(background);

    this.camera = new Entity("World camera");
    this.camera.addComponent("camera", { clearColor: hexColor(background), farClip: 100000 });
    this.app.root.addChild(this.camera);

    const supplied = camera?.position && camera?.target;
    this.orbit = {
      target: new Vec3(...(camera?.target || [0, 0, 0])),
      yaw: 35,
      pitch: -18,
      distance: 8,
    };
    if (supplied) this.setFromCamera(camera.position, camera.target);
    if (camera?.fov) this.camera.camera.fov = camera.fov;
    this.hasSuppliedCamera = Boolean(supplied);
    this.installControls();
    this.createEditorGizmo();
    this.updateCamera();
    this.app.on("update", this.updateOverlays, this);
    this.app.start();
  }

  setFromCamera(position, target) {
    const offset = new Vec3(...position).sub(new Vec3(...target));
    const distance = Math.max(offset.length(), 0.01);
    this.orbit.target.set(...target);
    this.orbit.distance = distance;
    this.orbit.pitch = Math.asin(clamp(offset.y / distance, -1, 1)) * 180 / Math.PI;
    this.orbit.yaw = Math.atan2(offset.x, offset.z) * 180 / Math.PI;
  }

  cameraState() {
    const position = this.camera.getPosition();
    const forward = this.orbit.target.clone().sub(position).normalize();
    return {
      position: [position.x, position.y, position.z],
      forward: [forward.x, forward.y, forward.z],
      up: [0, 1, 0],
    };
  }

  updateCamera() {
    const yaw = this.orbit.yaw * Math.PI / 180;
    const pitch = this.orbit.pitch * Math.PI / 180;
    const horizontal = Math.cos(pitch) * this.orbit.distance;
    this.camera.setPosition(
      this.orbit.target.x + Math.sin(yaw) * horizontal,
      this.orbit.target.y + Math.sin(pitch) * this.orbit.distance,
      this.orbit.target.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(this.orbit.target);
    this.onCameraChange(this.cameraState());
  }

  installControls() {
    const signal = this.abort.signal;
    let drag = null;
    let pinch = null;
    let click = null;
    const pointers = new Map();
    const point = (event) => ({ x: event.clientX, y: event.clientY });

    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, point(event));
      drag = { ...point(event), pan: event.button !== 0 || event.shiftKey };
      click = event.button === 0 ? { id: event.pointerId, ...point(event), moved: false } : null;
      if (pointers.size === 2) {
        pinch = this.pinchState(pointers);
        click = null;
      }
    }, { signal });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      const previous = pointers.get(event.pointerId);
      pointers.set(event.pointerId, point(event));
      if (click && Math.hypot(event.clientX - click.x, event.clientY - click.y) > 6) click.moved = true;
      if (pointers.size === 2) {
        const next = this.pinchState(pointers);
        if (pinch) {
          this.pan(next.cx - pinch.cx, next.cy - pinch.cy);
          this.zoom(pinch.distance / Math.max(next.distance, 1));
        }
        pinch = next;
      } else if (drag) {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        if (drag.pan) this.pan(dx, dy);
        else {
          this.orbit.yaw -= dx * 0.25;
          this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.25, -89, 89);
          this.updateCamera();
        }
      }
    }, { signal });
    const end = (event) => {
      const shouldActivate = event.type === "pointerup" && click?.id === event.pointerId && !click.moved;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) drag = null;
      if (shouldActivate) {
        const entity = this.editor.mode === "edit"
          ? this.activateWorldEntityAt(event.clientX, event.clientY)
          : null;
        const touchpoint = entity ? null : this.activateTouchpointAt(event.clientX, event.clientY);
        if (!entity && !touchpoint && this.editor.mode === "edit") {
          this.onWorldEntity({ action: "select", target: null });
        }
      }
      click = null;
    };
    this.canvas.addEventListener("pointerup", end, { signal });
    this.canvas.addEventListener("pointercancel", end, { signal });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoom(Math.exp(event.deltaY * 0.001));
    }, { passive: false, signal });

    this.canvas.addEventListener("dragover", (event) => {
      if (!hasHodosWorldDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      this.canvas.dataset.worldDropActive = "true";
    }, { signal });
    this.canvas.addEventListener("dragleave", () => {
      delete this.canvas.dataset.worldDropActive;
    }, { signal });
    this.canvas.addEventListener("drop", (event) => {
      if (!hasHodosWorldDrag(event.dataTransfer)) return;
      event.preventDefault();
      delete this.canvas.dataset.worldDropActive;
      try {
        const payload = readHodosWorldDrag(event.dataTransfer);
        const position = this.worldPointAt(event.clientX, event.clientY);
        this.onWorldDrop({ payload, position, clientX: event.clientX, clientY: event.clientY });
      } catch (error) {
        console.error("Hodos world drop failed", error);
      }
    }, { signal });

    document.addEventListener("visibilitychange", () => {
      this.app.autoRender = !document.hidden;
      if (!document.hidden) this.app.renderNextFrame = true;
    }, { signal });
  }

  pinchState(pointers) {
    const [a, b] = [...pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  zoom(multiplier) {
    this.orbit.distance = clamp(this.orbit.distance * multiplier, 0.01, 1e6);
    this.updateCamera();
  }

  pan(dx, dy) {
    const scale = this.orbit.distance * 0.0015;
    const right = this.camera.right.clone().mulScalar(-dx * scale);
    const up = this.camera.up.clone().mulScalar(dy * scale);
    this.orbit.target.add(right).add(up);
    this.updateCamera();
  }

  screenRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const width = this.app.graphicsDevice.width || this.canvas.width || rect.width;
    const height = this.app.graphicsDevice.height || this.canvas.height || rect.height;
    if (!rect.width || !rect.height || !width || !height) return null;
    const x = (clientX - rect.left) / rect.width * width;
    const y = (clientY - rect.top) / rect.height * height;
    const origin = this.camera.getPosition().clone();
    const far = this.camera.camera.screenToWorld(x, y, this.camera.camera.farClip, new Vec3());
    return { origin, direction: far.sub(origin).normalize() };
  }

  worldPointAt(clientX, clientY) {
    const ray = this.screenRay(clientX, clientY);
    if (!ray) return [this.orbit.target.x, this.orbit.target.y, this.orbit.target.z];
    const floorY = this.bounds
      ? this.bounds.center.y - this.bounds.halfExtents.y
      : this.orbit.target.y;
    if (Math.abs(ray.direction.y) > 1e-5) {
      const distance = (floorY - ray.origin.y) / ray.direction.y;
      if (distance > 0) {
        const point = ray.origin.clone().add(ray.direction.clone().mulScalar(distance));
        return [point.x, point.y + 0.2, point.z];
      }
    }
    const normal = this.orbit.target.clone().sub(ray.origin).normalize();
    const denominator = ray.direction.dot(normal);
    const distance = Math.abs(denominator) > 1e-5
      ? this.orbit.target.clone().sub(ray.origin).dot(normal) / denominator
      : this.orbit.distance;
    const point = ray.origin.clone().add(ray.direction.clone().mulScalar(Math.max(0.1, distance)));
    return [point.x, point.y, point.z];
  }

  editorSpawnPosition() {
    return [this.orbit.target.x, this.orbit.target.y + 0.5, this.orbit.target.z];
  }

  assetFor(url) {
    if (this.assets.has(url)) return this.assets.get(url);
    const asset = new Asset(url.split("/").pop(), "gsplat", { url });
    this.app.assets.add(asset);
    this.assets.set(url, asset);
    return asset;
  }

  async loadLayer(layer) {
    if (this.destroyed) throw new Error("Renderer was destroyed");
    let parent = this.app.root;
    layer.transformChain.forEach((transform, index) => {
      parent = addTransform(parent, transform, `${layer.id} transform ${index + 1}`);
      this.entities.push(parent);
    });
    const entity = new Entity(layer.id);
    parent.addChild(entity);
    this.entities.push(entity);
    const asset = this.assetFor(layer.assetUrl);

    try {
      await new Promise((resolve, reject) => {
        if (asset.resource) return resolve();
        asset.once("load", resolve);
        asset.once("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
        this.app.assets.load(asset);
      });
      entity.addComponent("gsplat", { asset });
      this.includeBounds(asset.resource?.aabb, entity);
      this.onLayer({ layer, status: "loaded" });
      return entity;
    } catch (error) {
      entity.destroy();
      this.onLayer({ layer, status: "failed", error });
      throw error;
    }
  }

  includeBounds(localBounds, entity) {
    if (!localBounds) return;
    const worldBounds = new BoundingBox();
    worldBounds.setFromTransformedAabb(localBounds, entity.getWorldTransform());
    if (this.bounds) this.bounds.add(worldBounds);
    else this.bounds = worldBounds.clone();
  }

  async loadLayers(layers) {
    const results = await Promise.allSettled(layers.map((layer) => this.loadLayer(layer)));
    if (!this.hasSuppliedCamera) this.resetCamera();
    return results;
  }

  createTouchpointButton(touchpoint) {
    if (!this.touchpointRoot) return null;
    const document = this.touchpointRoot.ownerDocument ?? globalThis.document;
    const control = document.createElement("button");
    control.type = "button";
    control.className = "hodos-touchpoint";
    control.setAttribute("aria-label", touchpoint.label);
    const text = document.createElement("span");
    text.textContent = touchpoint.label;
    const hint = document.createElement("small");
    hint.textContent = "Open surface";
    text.append(hint);
    control.append(text);
    control.addEventListener("click", () => this.onTouchpoint(touchpoint));
    this.touchpointRoot.append(control);
    return control;
  }

  addTouchpoint(touchpoint) {
    let parent = this.app.root;
    if (touchpoint.anchor !== "scene-center") {
      (touchpoint.transformChain ?? []).forEach((transform, index) => {
        parent = addTransform(parent, transform, `${touchpoint.id} touchpoint transform ${index + 1}`);
        this.entities.push(parent);
      });
    }

    const anchor = new Entity(`${touchpoint.id} touchpoint`);
    if (touchpoint.anchor === "scene-center" && this.bounds) {
      anchor.setPosition(this.bounds.center.clone().add(new Vec3(...touchpoint.position)));
    } else {
      anchor.setLocalPosition(...touchpoint.position);
    }
    parent.addChild(anchor);
    this.entities.push(anchor);
    const control = this.createTouchpointButton(touchpoint);
    const inheritedScale = touchpoint.anchor === "scene-center"
      ? 1
      : (touchpoint.transformChain ?? []).reduce((scale, transform) => scale * (transform.scale ?? 1), 1);
    const entry = { touchpoint, anchor, button: control, radius: touchpoint.radius * inheritedScale, projected: new Vec3() };
    this.touchpoints.push(entry);
    return entry;
  }

  loadTouchpoints(touchpoints = []) {
    for (const touchpoint of touchpoints) this.addTouchpoint(touchpoint);
    this.updateOverlays();
    return this.touchpoints;
  }

  activateTouchpointAt(clientX, clientY) {
    if (!this.touchpoints.length) return null;
    const ray = this.screenRay(clientX, clientY);
    if (!ray) return null;
    let nearest = null;

    for (const entry of this.touchpoints) {
      const center = entry.anchor.getPosition();
      const offset = center.clone().sub(ray.origin);
      const along = offset.dot(ray.direction);
      if (along < 0) continue;
      const closest = ray.origin.clone().add(ray.direction.clone().mulScalar(along));
      const distance = center.clone().sub(closest).length();
      if (distance > entry.radius) continue;
      if (!nearest || along < nearest.distance) nearest = { entry, distance: along };
    }

    if (!nearest) return null;
    this.onTouchpoint(nearest.entry.touchpoint);
    return nearest.entry.touchpoint;
  }

  makeMaterial(color, opacity = 1) {
    const material = new StandardMaterial();
    material.diffuse.copy(hexColor(color));
    material.emissive.set(0, 0, 0);
    material.opacity = clamp(Number(opacity ?? 1), 0.05, 1);
    if (material.opacity < 1) {
      material.blendType = BLEND_NORMAL;
      material.depthWrite = false;
    }
    material.metalness = 0.05;
    material.gloss = 0.35;
    material.update();
    return material;
  }

  createWorldEntityEntry(value) {
    const data = normalizeWorldEntity(value);
    const root = new Entity(data.name);
    this.app.root.addChild(root);
    let visual = root;
    let material;

    if (data.kind === "point-light") {
      const light = data.components.light ?? {};
      root.addComponent("light", {
        type: "omni",
        color: hexColor(light.color || "#fff1ca"),
        intensity: Number(light.intensity ?? 1),
        range: Number(light.range ?? 12),
        castShadows: Boolean(light.castShadows),
      });
      visual = new Entity(`${data.name} helper`);
      material = this.makeMaterial(light.color || "#fff1ca", 0.9);
      visual.addComponent("render", { type: "sphere", material });
      visual.setLocalScale(0.18, 0.18, 0.18);
      root.addChild(visual);
    } else if (data.kind === "empty") {
      visual = new Entity(`${data.name} helper`);
      material = this.makeMaterial("#9eb7aa", 0.55);
      visual.addComponent("render", { type: "sphere", material });
      visual.setLocalScale(0.13, 0.13, 0.13);
      root.addChild(visual);
    } else {
      const primitive = data.components.primitive ?? {};
      material = this.makeMaterial(primitive.color || "#c8ad73", primitive.opacity ?? 1);
      root.addComponent("render", { type: primitiveType(primitive.shape || data.kind), material });
    }

    const entry = { data, root, visual, material, radius: worldEntityRadius(data) };
    this.worldEntities.set(data.id, entry);
    this.entities.push(root);
    this.updateWorldEntityEntry(entry, data);
    return entry;
  }

  updateMaterial(entry, selected) {
    if (!entry.material) return;
    const data = entry.data;
    const color = data.components.primitive?.color
      ?? data.components.light?.color
      ?? "#9eb7aa";
    entry.material.diffuse.copy(hexColor(color));
    if (selected) {
      entry.material.emissive.copy(hexColor("#7a5e20"));
      entry.material.emissiveIntensity = 0.75;
    } else {
      entry.material.emissive.set(0, 0, 0);
      entry.material.emissiveIntensity = 1;
    }
    if (data.components.primitive) {
      entry.material.opacity = clamp(Number(data.components.primitive.opacity ?? 1), 0.05, 1);
      entry.material.blendType = entry.material.opacity < 1 ? BLEND_NORMAL : 0;
      entry.material.depthWrite = entry.material.opacity >= 1;
    }
    entry.material.update();
  }

  updateWorldEntityEntry(entry, value) {
    const data = normalizeWorldEntity(value);
    entry.data = data;
    entry.root.name = data.name;
    entry.root.enabled = data.visible !== false;
    entry.root.setLocalPosition(...data.transform.position);
    entry.root.setLocalEulerAngles(...data.transform.rotation);
    entry.root.setLocalScale(...data.transform.scale);
    entry.radius = worldEntityRadius(data);
    if (entry.root.light && data.components.light) {
      entry.root.light.color = hexColor(data.components.light.color || "#fff1ca");
      entry.root.light.intensity = Number(data.components.light.intensity ?? 1);
      entry.root.light.range = Number(data.components.light.range ?? 12);
      entry.root.light.castShadows = Boolean(data.components.light.castShadows);
    }
    const active = this.editor.active;
    this.updateMaterial(entry, active?.type === "entity" && active.id === data.id);
  }

  removeWorldEntity(id) {
    const entry = this.worldEntities.get(id);
    if (!entry) return;
    entry.material?.destroy?.();
    entry.root.destroy();
    this.worldEntities.delete(id);
  }

  syncWorldEntities(values = [], editor = this.editor) {
    this.editor = editorState(editor);
    const normalized = values.map(normalizeWorldEntity);
    const nextIds = new Set(normalized.map((entity) => entity.id));
    for (const id of [...this.worldEntities.keys()]) if (!nextIds.has(id)) this.removeWorldEntity(id);
    for (const data of normalized) {
      const entry = this.worldEntities.get(data.id);
      if (!entry || entry.data.kind !== data.kind) {
        if (entry) this.removeWorldEntity(data.id);
        this.createWorldEntityEntry(data);
      } else {
        this.updateWorldEntityEntry(entry, data);
      }
    }
    for (const data of normalized) {
      const entry = this.worldEntities.get(data.id);
      const parent = data.parent ? this.worldEntities.get(data.parent)?.root : null;
      const desired = parent || this.app.root;
      if (entry?.root.parent !== desired) desired.addChild(entry.root);
      if (entry) this.updateWorldEntityEntry(entry, data);
    }
    for (const entry of this.worldEntities.values()) this.updateMaterial(
      entry,
      this.editor.active?.type === "entity" && this.editor.active.id === entry.data.id,
    );
    this.updateEditorGizmo();
    this.updateOverlays();
  }

  activateWorldEntityAt(clientX, clientY) {
    const ray = this.screenRay(clientX, clientY);
    if (!ray) return null;
    let nearest = null;
    const candidates = [];
    for (const entry of this.worldEntities.values()) {
      if (entry.data.visible === false || entry.data.locked) continue;
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
    this.onWorldEntity({ action: "select", target });
    return target;
  }

  createAudioSourceElement(source) {
    if (!this.audioSourceRoot) return null;
    const document = this.audioSourceRoot.ownerDocument ?? globalThis.document;
    const root = document.createElement("div");
    root.className = "hodos-audio-source";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "hodos-audio-source-main";
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    const state = document.createElement("small");
    copy.append(label, state);
    main.append(copy);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "hodos-audio-source-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${source.label || source.id}`);
    main.addEventListener("click", () => {
      const current = this.audioSources.get(source.id)?.source || source;
      if (this.editor.mode === "edit") {
        this.onWorldEntity({ action: "select", target: { type: "audio", id: current.id } });
      } else {
        this.onAudioSource({ action: "toggle", source: current });
      }
    });
    remove.addEventListener("click", () => this.onAudioSource({ action: "remove", source: this.audioSources.get(source.id)?.source || source }));
    root.append(main, remove);
    this.audioSourceRoot.append(root);
    return { root, main, remove, label, state };
  }

  addAudioSource(source) {
    const anchor = new Entity(`${source.id} spatial audio`);
    anchor.setPosition(...sourcePosition(source));
    this.app.root.addChild(anchor);
    this.entities.push(anchor);
    const controls = this.createAudioSourceElement(source);
    const entry = { source, anchor, controls, projected: new Vec3() };
    this.audioSources.set(source.id, entry);
    this.updateAudioSourceEntry(entry, source);
    return entry;
  }

  updateAudioSourceEntry(entry, source) {
    entry.source = source;
    entry.anchor.setPosition(...sourcePosition(source));
    if (!entry.controls) return;
    entry.controls.root.dataset.playing = String(Boolean(source.playing));
    entry.controls.root.dataset.selected = String(this.editor.active?.type === "audio" && this.editor.active.id === source.id);
    entry.controls.label.textContent = source.label || source.id;
    entry.controls.state.textContent = source.playing ? "Playing in world" : "Paused in world";
    entry.controls.main.setAttribute("aria-label", `${this.editor.mode === "edit" ? "Select" : source.playing ? "Pause" : "Play"} ${source.label || source.id}`);
    entry.controls.remove.setAttribute("aria-label", `Remove ${source.label || source.id}`);
  }

  removeAudioSource(id) {
    const entry = this.audioSources.get(id);
    if (!entry) return;
    entry.controls?.root.remove();
    entry.anchor.destroy();
    this.audioSources.delete(id);
  }

  syncAudioSources(sources = []) {
    const nextIds = new Set(sources.map((source) => source.id));
    for (const id of this.audioSources.keys()) if (!nextIds.has(id)) this.removeAudioSource(id);
    for (const source of sources) {
      const entry = this.audioSources.get(source.id);
      if (entry) this.updateAudioSourceEntry(entry, source);
      else this.addAudioSource(source);
    }
    this.updateEditorGizmo();
    this.updateOverlays();
  }

  createEditorGizmo() {
    if (!this.entityOverlayRoot) return;
    const document = this.entityOverlayRoot.ownerDocument ?? globalThis.document;
    const root = document.createElement("div");
    root.className = "hodos-entity-gizmo";
    root.hidden = true;
    for (const [axis, label] of AXES.entries()) {
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.axis = label;
      control.innerHTML = `<span>${label.toUpperCase()}</span>`;
      control.setAttribute("aria-label", `Transform ${label.toUpperCase()} axis`);
      this.installGizmoDrag(control, axis);
      root.append(control);
    }
    this.entityOverlayRoot.append(root);
    this.gizmo = { root, projected: new Vec3() };
  }

  activeEditorTarget() {
    const active = this.editor.active;
    if (!active) return null;
    if (active.type === "audio") {
      const entry = this.audioSources.get(active.id);
      return entry ? {
        type: "audio",
        id: active.id,
        anchor: entry.anchor,
        source: entry.source,
        transform: { position: sourcePosition(entry.source), rotation: [0, 0, 0], scale: [1, 1, 1] },
      } : null;
    }
    const entry = this.worldEntities.get(active.id);
    return entry ? {
      type: "entity",
      id: active.id,
      anchor: entry.root,
      entity: entry.data,
      transform: cloneTransform(entry.data.transform),
    } : null;
  }

  previewTargetTransform(target, transform) {
    if (target.type === "audio") {
      target.anchor.setPosition(...transform.position);
    } else {
      target.anchor.setLocalPosition(...transform.position);
      target.anchor.setLocalEulerAngles(...transform.rotation);
      target.anchor.setLocalScale(...transform.scale);
    }
    this.updateOverlays();
  }

  installGizmoDrag(control, axis) {
    let drag = null;
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.editor.mode !== "edit") return;
      const target = this.activeEditorTarget();
      if (!target) return;
      control.setPointerCapture(event.pointerId);
      drag = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target,
        original: cloneTransform(target.transform),
        next: cloneTransform(target.transform),
      };
      event.preventDefault();
      event.stopPropagation();
    });
    control.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const screenDelta = (event.clientX - drag.x) - (event.clientY - drag.y);
      const tool = drag.target.type === "audio" ? "translate" : this.editor.tool;
      const next = cloneTransform(drag.original);
      if (tool === "translate") {
        const raw = drag.original.position[axis] + screenDelta * Math.max(0.001, this.orbit.distance * 0.0022);
        next.position[axis] = event.shiftKey ? Math.round(raw * 4) / 4 : raw;
      } else if (tool === "rotate") {
        const raw = drag.original.rotation[axis] + screenDelta * 0.45;
        next.rotation[axis] = event.shiftKey ? Math.round(raw / 5) * 5 : raw;
      } else if (tool === "scale") {
        const raw = Math.max(0.01, drag.original.scale[axis] + screenDelta * 0.01);
        next.scale[axis] = event.shiftKey ? Math.round(raw * 10) / 10 : raw;
      }
      drag.next = next;
      this.previewTargetTransform(drag.target, next);
    });
    const finish = (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const { target, next } = drag;
      drag = null;
      if (target.type === "audio") {
        this.onWorldEntity({ action: "audio-transform", source: target.id, position: next.position });
      } else {
        this.onWorldEntity({ action: "transform", entity: target.id, transform: next });
      }
    };
    control.addEventListener("pointerup", finish);
    control.addEventListener("pointercancel", () => {
      if (drag) this.previewTargetTransform(drag.target, drag.original);
      drag = null;
    });
  }

  updateEditorGizmo() {
    if (!this.gizmo) return;
    const target = this.activeEditorTarget();
    const visible = this.editor.mode === "edit" && target && this.editor.tool !== "select";
    this.gizmo.root.hidden = !visible;
    if (!visible) return;
    this.gizmo.root.dataset.tool = target.type === "audio" ? "translate" : this.editor.tool;
    this.gizmo.root.dataset.audio = String(target.type === "audio");
  }

  projectOverlay(entry, element, marginX = 80, marginY = 60) {
    if (!element) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = this.app.graphicsDevice.width || this.canvas.width || rect.width;
    const height = this.app.graphicsDevice.height || this.canvas.height || rect.height;
    if (!rect.width || !rect.height || !width || !height) {
      element.hidden = true;
      return;
    }
    this.camera.camera.worldToScreen(entry.anchor.getPosition(), entry.projected);
    const x = entry.projected.x / width * rect.width;
    const y = entry.projected.y / height * rect.height;
    const visible = entry.projected.z > 0
      && x >= -marginX && x <= rect.width + marginX
      && y >= -marginY && y <= rect.height + marginY;
    element.hidden = !visible;
    if (!visible) return;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  updateOverlays() {
    if (this.destroyed) return;
    for (const entry of this.touchpoints) this.projectOverlay(entry, entry.button);
    for (const entry of this.audioSources.values()) this.projectOverlay(entry, entry.controls?.root, 100, 70);
    if (this.gizmo && !this.gizmo.root.hidden) {
      const target = this.activeEditorTarget();
      if (target) this.projectOverlay({ anchor: target.anchor, projected: this.gizmo.projected }, this.gizmo.root, 100, 100);
    }
  }

  focusEditorSelection() {
    const target = this.activeEditorTarget();
    if (!target) return;
    const position = target.anchor.getPosition();
    this.orbit.target.copy(position);
    const radius = target.type === "entity" ? worldEntityRadius(target.entity) : 0.4;
    this.orbit.distance = Math.max(radius * 4.5, 1.5);
    this.updateCamera();
  }

  focusCamera(camera) {
    if (!camera?.position || !camera?.target) return;
    this.setFromCamera(camera.position, camera.target);
    if (camera.fov) this.camera.camera.fov = camera.fov;
    this.updateCamera();
  }

  resetCamera() {
    if (!this.bounds) return;
    const radius = Math.max(this.bounds.halfExtents.length(), 0.1);
    this.orbit.target.copy(this.bounds.center);
    this.orbit.distance = radius / Math.tan((this.camera.camera.fov * Math.PI / 180) / 2) * 1.25;
    this.updateCamera();
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
    this.app.off("update", this.updateOverlays, this);
    for (const { button: control } of this.touchpoints) control?.remove();
    for (const id of [...this.audioSources.keys()]) this.removeAudioSource(id);
    for (const id of [...this.worldEntities.keys()]) this.removeWorldEntity(id);
    this.gizmo?.root.remove();
    this.touchpoints = [];
    this.app.destroy();
    this.assets.clear();
    this.entities = [];
  }
}
