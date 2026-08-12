import {
  createMixamoRetargetPlan,
  inspectMixamoSkeleton,
} from "@greenways/hodos-world-model/mixamo";
import {
  DEFAULT_MIXAMO_MAX_CHARACTERS,
  DEFAULT_MIXAMO_MAX_NODES,
  PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA,
  PLAYCANVAS_MIXAMO_PROVIDER_ID,
  PLAYCANVAS_MIXAMO_PROVIDER_VERSION,
  PlayCanvasMixamoCharacterHostError,
  findMixamoAnimation,
  finite,
  flattenMixamoEntityHierarchy,
  mixamoAnimationLayer,
  mixamoClipCatalog,
  mixamoClipDescriptor,
  mixamoReferences,
  optionalString,
  portableCopy,
  portableMixamoClip,
  positiveSafeInteger,
  requiredString,
} from "./mixamo-character-values.js";

export {
  PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA,
  PLAYCANVAS_MIXAMO_PROVIDER_ID,
  PLAYCANVAS_MIXAMO_PROVIDER_VERSION,
  PlayCanvasMixamoCharacterHostError,
} from "./mixamo-character-values.js";

export class PlayCanvasMixamoCharacterHost {
  constructor({
    id = "playcanvas-mixamo",
    maximumCharacters = DEFAULT_MIXAMO_MAX_CHARACTERS,
    maximumNodes = DEFAULT_MIXAMO_MAX_NODES,
  } = {}) {
    this.id = requiredString(id, "Mixamo host id");
    this.maximumCharacters = positiveSafeInteger(maximumCharacters, DEFAULT_MIXAMO_MAX_CHARACTERS, "maximumCharacters");
    this.maximumNodes = positiveSafeInteger(maximumNodes, DEFAULT_MIXAMO_MAX_NODES, "maximumNodes");
    this.records = new Map();
    this.referenceIndex = new Map();
    this.nextHandle = 1;
    this.destroyed = false;
  }

  register(root, {
    id,
    assetId = null,
    revision = 0,
    mediaType = "model/gltf-binary",
    clips = {},
    animationComponent = null,
  } = {}) {
    this.assertActive();
    id = requiredString(id, "Mixamo character id");
    if (this.records.size >= this.maximumCharacters) {
      throw new PlayCanvasMixamoCharacterHostError("mixamo/character-limit", `Host reached its ${this.maximumCharacters} character limit`);
    }
    if (this.referenceIndex.has(id)) {
      throw new PlayCanvasMixamoCharacterHostError("mixamo/character-id", `Character is already registered: ${id}`);
    }
    const hierarchy = flattenMixamoEntityHierarchy(root, this.maximumNodes);
    const profile = inspectMixamoSkeleton(hierarchy.nodes, {
      id: `${id}/mixamo-profile`,
      assetId,
      revision,
      mediaType,
      maximumNodes: this.maximumNodes,
    });
    if (profile.status !== "supported") {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/skeleton-unsupported",
        `Character ${id} does not expose a supported Mixamo humanoid skeleton`,
        {
          missingRequired: profile.missingRequired,
          duplicateJoints: profile.duplicateJoints,
          errors: profile.diagnostics.errors,
        },
      );
    }
    const animation = animationComponent
      ? { component: animationComponent, kind: animationComponent.baseLayer ? "anim" : "custom" }
      : findMixamoAnimation(root);
    const handle = `mixamo-character:${this.id}:${this.nextHandle++}`;
    const record = {
      handle,
      id,
      assetId: optionalString(assetId, "Mixamo character assetId"),
      mediaType,
      root,
      rootNodeId: hierarchy.rootNodeId,
      profile,
      clips: mixamoClipCatalog(clips),
      animationComponent: animation.component,
      animationKind: animation.kind,
    };
    this.records.set(handle, record);
    for (const reference of [handle, id, hierarchy.rootNodeId]) this.referenceIndex.set(reference, handle);
    return this.describe(handle);
  }

  assignClip(reference, clipId, track, options = {}) {
    const record = this.record(reference);
    if (!track || typeof track !== "object") throw new TypeError("Mixamo track must be an AnimTrack-like object");
    const descriptor = mixamoClipDescriptor(clipId, {
      ...options,
      state: options.state ?? clipId,
      duration: options.duration ?? (Number.isFinite(track.duration) ? track.duration : null),
    });
    const component = record.animationComponent;
    if (typeof component?.assignAnimation === "function") {
      component.assignAnimation(descriptor.state, track, descriptor.layer, descriptor.speed, descriptor.loop);
    } else {
      const layer = mixamoAnimationLayer(component, descriptor.layer);
      if (typeof layer?.assignAnimation !== "function") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/animation-component",
          `Character ${record.id} needs a PlayCanvas AnimComponent to assign tracks`,
        );
      }
      layer.assignAnimation(descriptor.state, track, descriptor.speed, descriptor.loop);
    }
    component?.rebind?.();
    record.clips.set(descriptor.id, { ...descriptor, owned: true, track });
    return portableCopy(portableMixamoClip(record.clips.get(descriptor.id)));
  }

  play(reference, clipId, { blend = 0, speed = null, layer = null } = {}) {
    const record = this.record(reference);
    clipId = requiredString(clipId, "Mixamo clip id");
    const clip = record.clips.get(clipId);
    if (!clip) throw new PlayCanvasMixamoCharacterHostError("mixamo/clip-missing", `Character ${record.id} has no clip ${clipId}`);
    const component = record.animationComponent;
    const requestedSpeed = finite(speed, clip.speed, "Mixamo playback speed", 0);
    const requestedBlend = finite(blend, 0, "Mixamo playback blend", 0);
    const layerName = optionalString(layer, "Mixamo playback layer") ?? clip.layer;
    if (component && "speed" in component) component.speed = requestedSpeed;
    const targetLayer = mixamoAnimationLayer(component, layerName);
    if (typeof targetLayer?.transition === "function") targetLayer.transition(clip.state, requestedBlend);
    else if (typeof targetLayer?.play === "function") targetLayer.play(clip.state);
    else if (typeof component?.play === "function") component.play(clip.state, requestedBlend);
    else throw new PlayCanvasMixamoCharacterHostError("mixamo/animation-component", `Character ${record.id} has no playable animation component`);
    return Object.freeze({
      provider: Object.freeze({ id: PLAYCANVAS_MIXAMO_PROVIDER_ID, version: PLAYCANVAS_MIXAMO_PROVIDER_VERSION }),
      handle: record.handle,
      characterId: record.id,
      clipId,
      state: clip.state,
      duration: clip.duration,
      loop: clip.loop,
      speed: requestedSpeed,
      blend: requestedBlend,
      layer: layerName,
    });
  }

  pause(reference, { layer = null } = {}) {
    const record = this.record(reference);
    const component = record.animationComponent;
    const targetLayer = mixamoAnimationLayer(component, optionalString(layer, "Mixamo pause layer"));
    if (typeof targetLayer?.pause === "function") targetLayer.pause();
    else if (typeof component?.pause === "function") component.pause();
    else if (component && "playing" in component) component.playing = false;
    else return false;
    return true;
  }

  createRetargetPlan(sourceReference, targetReference, options = {}) {
    return createMixamoRetargetPlan(this.record(sourceReference).profile, this.record(targetReference).profile, options);
  }

  resolveEntity(reference) {
    return this.record(reference).root;
  }

  resolveClipDuration(effectOrReference, clipId = null) {
    let reference = effectOrReference;
    if (effectOrReference?.type === "sequence/action") {
      reference = effectOrReference.target;
      clipId = effectOrReference.action?.clip ?? effectOrReference.action?.gesture ?? null;
    }
    if (!clipId) return null;
    try {
      return this.record(reference).clips.get(String(clipId))?.duration ?? null;
    } catch {
      return null;
    }
  }

  sequenceOptions() {
    return Object.freeze({
      resolveEntity: (reference) => this.resolveEntity(reference),
      resolveClipDuration: (effect) => this.resolveClipDuration(effect),
    });
  }

  describe(reference) {
    const record = this.record(reference);
    return portableCopy({
      schema: PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA,
      provider: { id: PLAYCANVAS_MIXAMO_PROVIDER_ID, version: PLAYCANVAS_MIXAMO_PROVIDER_VERSION },
      handle: record.handle,
      id: record.id,
      assetId: record.assetId,
      entityId: record.rootNodeId,
      source: { mediaType: record.mediaType },
      profile: record.profile,
      animation: {
        component: record.animationKind,
        playable: Boolean(record.animationComponent),
        clips: [...record.clips.values()].map(portableMixamoClip).sort((left, right) => left.id.localeCompare(right.id)),
      },
      capabilities: ["character.animation", "mixamo.same-family-retarget", "sequence.character"],
    });
  }

  release(reference) {
    this.assertActive();
    let record;
    try {
      record = this.record(reference);
    } catch (error) {
      if (error instanceof PlayCanvasMixamoCharacterHostError && error.code === "mixamo/handle") return false;
      throw error;
    }
    for (const clip of record.clips.values()) {
      if (!clip.owned) continue;
      const component = record.animationComponent;
      if (typeof component?.removeNodeAnimations === "function") component.removeNodeAnimations(clip.state, clip.layer);
      else mixamoAnimationLayer(component, clip.layer)?.removeNodeAnimations?.(clip.state);
    }
    this.records.delete(record.handle);
    for (const [key, handle] of this.referenceIndex) if (handle === record.handle) this.referenceIndex.delete(key);
    record.clips.clear();
    record.root = null;
    record.animationComponent = null;
    return true;
  }

  evidence() {
    return Object.freeze({
      provider: Object.freeze({ id: PLAYCANVAS_MIXAMO_PROVIDER_ID, version: PLAYCANVAS_MIXAMO_PROVIDER_VERSION }),
      hostId: this.id,
      characters: this.records.size,
      maximumCharacters: this.maximumCharacters,
      maximumNodes: this.maximumNodes,
      destroyed: this.destroyed,
    });
  }

  destroy() {
    if (this.destroyed) return;
    for (const handle of [...this.records.keys()]) this.release(handle);
    this.destroyed = true;
  }

  record(reference) {
    this.assertActive();
    const candidates = mixamoReferences(reference);
    const direct = candidates.find((candidate) => this.records.has(candidate));
    const indexed = candidates.map((candidate) => this.referenceIndex.get(candidate)).find(Boolean);
    const record = this.records.get(direct ?? indexed);
    if (!record) throw new PlayCanvasMixamoCharacterHostError("mixamo/handle", `Unknown Mixamo character: ${candidates[0] ?? "<missing>"}`);
    return record;
  }

  assertActive() {
    if (this.destroyed) throw new PlayCanvasMixamoCharacterHostError("mixamo/host-destroyed", "Mixamo character host was destroyed");
  }
}

export function createPlayCanvasMixamoCharacterHost(options) {
  return new PlayCanvasMixamoCharacterHost(options);
}

export function inspectPlayCanvasMixamoCharacter(root, options = {}) {
  const maximumNodes = positiveSafeInteger(options.maximumNodes, DEFAULT_MIXAMO_MAX_NODES, "maximumNodes");
  const hierarchy = flattenMixamoEntityHierarchy(root, maximumNodes);
  return inspectMixamoSkeleton(hierarchy.nodes, {
    id: options.id ?? "mixamo/playcanvas-profile",
    assetId: options.assetId ?? null,
    revision: options.revision ?? 0,
    mediaType: options.mediaType ?? "model/gltf-binary",
    maximumNodes,
  });
}
