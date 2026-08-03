import {
  Application,
  Asset,
  BoundingBox,
  Color,
  Entity,
  FILLMODE_FILL_WINDOW,
  GSPLAT_RENDERER_AUTO,
  RESOLUTION_AUTO,
  Vec3,
} from "playcanvas";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

export class WorldRenderer {
  constructor(canvas, {
    background = "#09101a",
    camera,
    onLayer,
    onTouchpoint,
    touchpointRoot,
  } = {}) {
    this.canvas = canvas;
    this.onLayer = onLayer || (() => {});
    this.onTouchpoint = onTouchpoint || (() => {});
    this.touchpointRoot = touchpointRoot;
    this.assets = new Map();
    this.entities = [];
    this.touchpoints = [];
    this.bounds = null;
    this.destroyed = false;
    this.abort = new AbortController();

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
    this.updateCamera();
    this.app.on("update", () => this.updateTouchpoints());
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
      if (shouldActivate) this.activateTouchpointAt(event.clientX, event.clientY);
      click = null;
    };
    this.canvas.addEventListener("pointerup", end, { signal });
    this.canvas.addEventListener("pointercancel", end, { signal });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoom(Math.exp(event.deltaY * 0.001));
    }, { passive: false, signal });
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hodos-touchpoint";
    button.setAttribute("aria-label", touchpoint.label);
    const text = document.createElement("span");
    text.textContent = touchpoint.label;
    const hint = document.createElement("small");
    hint.textContent = "Open surface";
    text.append(hint);
    button.append(text);
    button.addEventListener("click", () => this.onTouchpoint(touchpoint));
    this.touchpointRoot.append(button);
    return button;
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
    const button = this.createTouchpointButton(touchpoint);
    const inheritedScale = touchpoint.anchor === "scene-center"
      ? 1
      : (touchpoint.transformChain ?? []).reduce((scale, transform) => scale * (transform.scale ?? 1), 1);
    const entry = { touchpoint, anchor, button, radius: touchpoint.radius * inheritedScale, projected: new Vec3() };
    this.touchpoints.push(entry);
    return entry;
  }

  loadTouchpoints(touchpoints = []) {
    for (const touchpoint of touchpoints) this.addTouchpoint(touchpoint);
    this.updateTouchpoints();
    return this.touchpoints;
  }

  activateTouchpointAt(clientX, clientY) {
    if (!this.touchpoints.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    const width = this.app.graphicsDevice.width || this.canvas.width || rect.width;
    const height = this.app.graphicsDevice.height || this.canvas.height || rect.height;
    if (!rect.width || !rect.height || !width || !height) return null;
    const x = (clientX - rect.left) / rect.width * width;
    const y = (clientY - rect.top) / rect.height * height;
    const origin = this.camera.getPosition().clone();
    const far = this.camera.camera.screenToWorld(x, y, this.camera.camera.farClip, new Vec3());
    const direction = far.sub(origin).normalize();
    let nearest = null;

    for (const entry of this.touchpoints) {
      const center = entry.anchor.getPosition();
      const offset = center.clone().sub(origin);
      const along = offset.dot(direction);
      if (along < 0) continue;
      const closest = origin.clone().add(direction.clone().mulScalar(along));
      const distance = center.clone().sub(closest).length();
      if (distance > entry.radius) continue;
      if (!nearest || along < nearest.distance) nearest = { entry, distance: along };
    }

    if (!nearest) return null;
    this.onTouchpoint(nearest.entry.touchpoint);
    return nearest.entry.touchpoint;
  }

  updateTouchpoints() {
    if (!this.touchpoints.length || this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = this.app.graphicsDevice.width || this.canvas.width || rect.width;
    const height = this.app.graphicsDevice.height || this.canvas.height || rect.height;
    if (!rect.width || !rect.height || !width || !height) return;

    for (const entry of this.touchpoints) {
      if (!entry.button) continue;
      this.camera.camera.worldToScreen(entry.anchor.getPosition(), entry.projected);
      const x = entry.projected.x / width * rect.width;
      const y = entry.projected.y / height * rect.height;
      const visible = entry.projected.z > 0
        && x >= -80 && x <= rect.width + 80
        && y >= -60 && y <= rect.height + 60;
      entry.button.hidden = !visible;
      if (!visible) continue;
      entry.button.style.left = `${x}px`;
      entry.button.style.top = `${y}px`;
    }
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
    for (const { button } of this.touchpoints) button?.remove();
    this.touchpoints = [];
    this.app.destroy();
    this.assets.clear();
    this.entities = [];
  }
}
