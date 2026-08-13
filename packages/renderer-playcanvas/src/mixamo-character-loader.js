import {
  PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA,
  PLAYCANVAS_MIXAMO_PROVIDER_ID,
  PLAYCANVAS_MIXAMO_PROVIDER_VERSION,
  PlayCanvasMixamoCharacterHost as RegisteredPlayCanvasMixamoCharacterHost,
  PlayCanvasMixamoCharacterHostError,
  inspectPlayCanvasMixamoCharacter,
} from "./mixamo-character-host.js";
import {
  findMixamoAnimation,
  optionalString,
  portableCopy,
  positiveSafeInteger,
  requiredString,
} from "./mixamo-character-values.js";

export {
  PLAYCANVAS_MIXAMO_CHARACTER_SCHEMA,
  PLAYCANVAS_MIXAMO_PROVIDER_ID,
  PLAYCANVAS_MIXAMO_PROVIDER_VERSION,
  PlayCanvasMixamoCharacterHostError,
  inspectPlayCanvasMixamoCharacter,
};

export const DEFAULT_MIXAMO_MAX_SOURCE_BYTES = 256 * 1024 * 1024;

const SUPPORTED_MIXAMO_MEDIA_TYPES = new Set([
  "model/gltf-binary",
  "model/gltf+json",
]);

function mediaTypeFromFileName(fileName, fallback = "model/gltf-binary") {
  const normalized = String(fileName ?? "").split(/[?#]/, 1)[0].toLowerCase();
  if (normalized.endsWith(".gltf")) return "model/gltf+json";
  if (normalized.endsWith(".fbx")) return "application/vnd.autodesk.fbx";
  if (normalized.endsWith(".dae")) return "model/vnd.collada+xml";
  if (normalized.endsWith(".glb")) return "model/gltf-binary";
  return fallback;
}

function safeSourceUrl(url) {
  return String(url).split(/[?#]/, 1)[0];
}

function fileNameFromUrl(url, fallback) {
  const path = safeSourceUrl(url);
  const segment = path.slice(path.lastIndexOf("/") + 1);
  if (!segment) return fallback;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizedFileName(value, fallback) {
  const fileName = optionalString(value, "Mixamo source fileName") ?? fallback;
  return fileName.replaceAll("\\", "/").split("/").at(-1) || fallback;
}

function supportedMediaType(value, fileName) {
  const mediaType = optionalString(value, "Mixamo source mediaType")
    ?? mediaTypeFromFileName(fileName);
  if (!SUPPORTED_MIXAMO_MEDIA_TYPES.has(mediaType)) {
    throw new PlayCanvasMixamoCharacterHostError(
      "mixamo/media-type",
      `Mixamo runtime loading requires GLB or glTF, not ${mediaType}`,
      { mediaType, fileName },
    );
  }
  return mediaType;
}

function isBlobLike(value) {
  return Boolean(
    value
    && typeof value === "object"
    && Number.isFinite(value.size)
    && value.size >= 0
    && typeof value.arrayBuffer === "function",
  );
}

function isContainerAsset(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value.type === "container"
    && ("resource" in value || "loaded" in value || typeof value.ready === "function"),
  );
}

function bytesLength(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return null;
}

function clipIdentifier(value, fallback) {
  const normalized = String(value ?? fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
  return normalized || fallback;
}

function uniqueClipIdentifier(candidate, used) {
  if (!used.has(candidate)) return candidate;
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

function animationTrack(asset) {
  if (asset?.resource && typeof asset.resource === "object") return asset.resource;
  return asset && typeof asset === "object" ? asset : null;
}

function animationResourceId(asset, index) {
  if (typeof asset?.id === "string" && asset.id.trim()) return `playcanvas-asset:${asset.id.trim()}`;
  if (Number.isSafeInteger(asset?.id) && asset.id >= 0) return `playcanvas-asset:${asset.id}`;
  if (typeof asset?.name === "string" && asset.name.trim()) return `playcanvas-animation:${asset.name.trim()}`;
  return `embedded-animation:${index}`;
}

function containerAnimations(asset) {
  const animations = asset?.resource?.animations;
  return Array.isArray(animations) ? animations : [];
}

function sourceAssetId(asset) {
  if (typeof asset?.id === "string" && asset.id.trim()) return asset.id.trim();
  if (Number.isSafeInteger(asset?.id) && asset.id >= 0) return String(asset.id);
  return null;
}

function loadFailure(message, error, details = null) {
  return new PlayCanvasMixamoCharacterHostError(
    "mixamo/load-failed",
    message,
    {
      ...(details ?? {}),
      cause: error instanceof Error ? error.message : String(error ?? "Unknown load failure"),
    },
  );
}

function unloadAsset(app, asset) {
  if (!asset) return;
  let failure = null;
  try {
    asset.unload?.();
  } catch (error) {
    failure = error;
  }
  try {
    app?.assets?.remove?.(asset);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

export class PlayCanvasMixamoCharacterHost extends RegisteredPlayCanvasMixamoCharacterHost {
  constructor({
    app = null,
    maximumSourceBytes = DEFAULT_MIXAMO_MAX_SOURCE_BYTES,
    BlobClass = globalThis.Blob ?? null,
    createObjectURL = globalThis.URL?.createObjectURL
      ? globalThis.URL.createObjectURL.bind(globalThis.URL)
      : null,
    revokeObjectURL = globalThis.URL?.revokeObjectURL
      ? globalThis.URL.revokeObjectURL.bind(globalThis.URL)
      : null,
    ...options
  } = {}) {
    super(options);
    this.app = app;
    this.maximumSourceBytes = positiveSafeInteger(
      maximumSourceBytes,
      DEFAULT_MIXAMO_MAX_SOURCE_BYTES,
      "maximumSourceBytes",
    );
    this.BlobClass = BlobClass;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.loadedRecords = new Map();
  }

  async load(source, {
    id,
    app = this.app,
    assetId = null,
    revision = 0,
    fileName = null,
    mediaType = null,
    clips = {},
    animationComponent = null,
    createAnimationComponent = true,
    assignEmbeddedAnimations = true,
    autoplay = false,
    autoplayOptions = {},
    attach = true,
    parent = null,
    entityName = null,
    renderOptions = {},
    animOptions = {},
  } = {}) {
    this.assertActive();
    id = requiredString(id, "Mixamo character id");
    this.assertCanLoad(id);
    if (!app?.assets) {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/app",
        "Mixamo loading requires a PlayCanvas Application with an asset registry",
      );
    }

    const prepared = this.prepareSource(source, { id, fileName, mediaType });
    let asset = null;
    let ownsAsset = false;
    let root = null;
    let handle = null;
    try {
      ({ asset, owned: ownsAsset } = await this.loadContainerAsset(app, prepared));
      const instantiate = asset?.resource?.instantiateRenderEntity;
      if (typeof instantiate !== "function") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/container-resource",
          `PlayCanvas asset ${asset?.name ?? prepared.fileName} is not an instantiable GLB/glTF container`,
        );
      }
      root = instantiate.call(asset.resource, renderOptions ?? {});
      if (!root || typeof root !== "object") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/container-resource",
          `PlayCanvas asset ${asset?.name ?? prepared.fileName} did not create an entity hierarchy`,
        );
      }
      if (entityName !== null && entityName !== undefined) {
        root.name = requiredString(entityName, "Mixamo entityName");
      }
      if (attach !== false) {
        const target = parent ?? app.root;
        if (typeof target?.addChild !== "function") {
          throw new PlayCanvasMixamoCharacterHostError(
            "mixamo/parent",
            "Mixamo loading requires an Entity-like parent when attach is enabled",
          );
        }
        target.addChild(root);
      }

      const embedded = containerAnimations(asset);
      const foundAnimation = findMixamoAnimation(root);
      const registered = super.register(root, {
        id,
        assetId,
        revision,
        mediaType: prepared.mediaType,
        clips,
        animationComponent: animationComponent ?? foundAnimation.component,
      });
      handle = registered.handle;
      this.loadedRecords.set(handle, {
        app,
        asset,
        ownsAsset,
        root,
        source: {
          kind: prepared.kind,
          fileName: prepared.fileName,
          mediaType: prepared.mediaType,
          url: prepared.kind === "url" ? safeSourceUrl(prepared.url) : null,
          playcanvasAssetId: sourceAssetId(asset),
        },
      });

      const record = this.record(handle);
      if (foundAnimation.component === record.animationComponent) {
        record.animationKind = foundAnimation.kind;
      }
      if (!record.animationComponent && createAnimationComponent !== false) {
        if (typeof root.addComponent !== "function") {
          throw new PlayCanvasMixamoCharacterHostError(
            "mixamo/animation-component",
            `Character ${id} cannot create a PlayCanvas AnimComponent`,
          );
        }
        root.addComponent("anim", {
          activate: false,
          speed: 1,
          ...(animOptions ?? {}),
        });
        record.animationComponent = root.anim ?? null;
        record.animationKind = record.animationComponent ? "anim" : null;
        if (!record.animationComponent) {
          throw new PlayCanvasMixamoCharacterHostError(
            "mixamo/animation-component",
            `Character ${id} did not expose the AnimComponent created by PlayCanvas`,
          );
        }
      }

      let assigned = [];
      if (assignEmbeddedAnimations !== false) {
        assigned = this.assignEmbeddedAnimations(handle, embedded);
      }
      const autoplayRequest = this.autoplayRequest(autoplay, assigned);
      if (autoplayRequest) {
        this.play(handle, autoplayRequest.clipId, {
          ...autoplayOptions,
          ...autoplayRequest.options,
        });
      }
      return this.describe(handle);
    } catch (error) {
      if (handle) {
        try {
          this.release(handle);
        } catch {
          // Preserve the original load failure.
        }
      } else {
        try {
          root?.destroy?.();
        } catch {
          // Best-effort rollback before registration.
        }
        if (ownsAsset) {
          try {
            unloadAsset(app, asset);
          } catch {
            // Best-effort rollback before registration.
          }
        }
      }
      if (error instanceof PlayCanvasMixamoCharacterHostError || error instanceof TypeError) throw error;
      throw loadFailure(`Unable to load Mixamo character ${id}`, error, {
        fileName: prepared.fileName,
        mediaType: prepared.mediaType,
      });
    } finally {
      try {
        prepared.revoke?.();
      } catch {
        // Object URL cleanup must not replace the result or primary failure.
      }
    }
  }

  loadUrl(url, options = {}) {
    return this.load(url, options);
  }

  loadFile(file, options = {}) {
    return this.load(file, options);
  }

  assignEmbeddedAnimations(reference, animations, {
    loop = true,
    speed = 1,
    layer = null,
  } = {}) {
    const record = this.record(reference);
    if (!Array.isArray(animations)) throw new TypeError("Embedded Mixamo animations must be an array");
    const assigned = [];
    const used = new Set(record.clips.keys());
    for (let index = 0; index < animations.length; index += 1) {
      const asset = animations[index];
      const track = animationTrack(asset);
      if (!track) continue;
      const fallback = `clip-${index + 1}`;
      const candidate = clipIdentifier(track.name ?? asset?.name, fallback);
      const declared = record.clips.get(candidate);
      const clipId = declared && !declared.track
        ? candidate
        : uniqueClipIdentifier(candidate, used);
      used.add(clipId);
      const options = declared ?? {};
      assigned.push(this.assignClip(record.handle, clipId, track, {
        state: options.state ?? clipId,
        duration: options.duration ?? (Number.isFinite(track.duration) ? track.duration : null),
        loop: options.loop ?? loop,
        speed: options.speed ?? speed,
        layer: options.layer ?? layer,
        resourceId: options.resourceId ?? animationResourceId(asset, index),
      }));
    }
    return portableCopy(assigned);
  }

  play(reference, clipId, options = {}) {
    const record = this.record(reference);
    if (record.animationComponent && "playing" in record.animationComponent) {
      record.animationComponent.playing = true;
    }
    return super.play(record.handle, clipId, options);
  }

  describe(reference) {
    const descriptor = super.describe(reference);
    const loaded = this.loadedRecords?.get(descriptor.handle) ?? null;
    return portableCopy({
      ...descriptor,
      source: loaded?.source ?? {
        kind: "registered",
        mediaType: descriptor.source.mediaType,
      },
      capabilities: [...new Set([...descriptor.capabilities, "character.load"])],
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
    const loaded = this.loadedRecords.get(record.handle) ?? null;
    let failure = null;
    let released = false;
    try {
      released = super.release(record.handle);
    } catch (error) {
      failure = error;
    }
    if (loaded) {
      try {
        loaded.root?.destroy?.();
      } catch (error) {
        failure ??= error;
      }
      if (loaded.ownsAsset) {
        try {
          unloadAsset(loaded.app, loaded.asset);
        } catch (error) {
          failure ??= error;
        }
      }
      this.loadedRecords.delete(record.handle);
    }
    if (failure) throw failure;
    return released;
  }

  evidence() {
    return Object.freeze({
      ...super.evidence(),
      loadedAssets: this.loadedRecords.size,
      maximumSourceBytes: this.maximumSourceBytes,
    });
  }

  assertCanLoad(id) {
    if (this.records.size >= this.maximumCharacters) {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/character-limit",
        `Host reached its ${this.maximumCharacters} character limit`,
      );
    }
    if (this.referenceIndex.has(id)) {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/character-id",
        `Character is already registered: ${id}`,
      );
    }
  }

  prepareSource(source, { id, fileName, mediaType }) {
    const asset = isContainerAsset(source?.asset) ? source.asset : (isContainerAsset(source) ? source : null);
    if (asset) {
      const assetFileName = normalizedFileName(
        fileName ?? source?.fileName ?? source?.filename ?? asset.file?.filename ?? asset.name,
        `${id}.glb`,
      );
      return {
        kind: "asset",
        asset,
        fileName: assetFileName,
        mediaType: supportedMediaType(mediaType ?? source?.mediaType, assetFileName),
        revoke: null,
      };
    }

    const descriptorUrl = source && typeof source === "object"
      ? (typeof source.url === "string" ? source.url : source.url?.href)
      : null;
    const directUrl = typeof source === "string" ? source : source?.href;
    if (directUrl || descriptorUrl) {
      const url = requiredString(descriptorUrl ?? directUrl, "Mixamo source URL");
      const urlFileName = normalizedFileName(
        fileName ?? source?.fileName ?? source?.filename,
        fileNameFromUrl(url, `${id}.glb`),
      );
      return {
        kind: "url",
        url,
        fileName: urlFileName,
        mediaType: supportedMediaType(mediaType ?? source?.mediaType, urlFileName),
        revoke: null,
      };
    }

    const local = source?.file ?? source?.blob ?? source;
    const byteLength = bytesLength(local);
    const blobLike = isBlobLike(local);
    if (!blobLike && byteLength === null) {
      throw new TypeError("Mixamo source must be a URL, File, Blob, ArrayBuffer, typed array, or PlayCanvas container asset");
    }
    const localSize = blobLike ? local.size : byteLength;
    if (localSize > this.maximumSourceBytes) {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/source-limit",
        `Mixamo source exceeds the ${this.maximumSourceBytes} byte local limit`,
        { size: localSize, maximumSourceBytes: this.maximumSourceBytes },
      );
    }
    const localFileName = normalizedFileName(
      fileName ?? source?.fileName ?? source?.filename ?? local?.name,
      `${id}.glb`,
    );
    const localMediaType = supportedMediaType(
      mediaType ?? source?.mediaType ?? (blobLike && local.type !== "application/octet-stream" ? local.type : null),
      localFileName,
    );
    if (localMediaType !== "model/gltf-binary") {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/local-gltf",
        "Local Mixamo loading requires a self-contained GLB; use a URL for glTF files with external resources",
        { fileName: localFileName, mediaType: localMediaType },
      );
    }
    if (typeof this.createObjectURL !== "function" || typeof this.revokeObjectURL !== "function") {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/object-url",
        "This host cannot create and revoke an object URL for a local Mixamo GLB",
      );
    }
    let blob = local;
    if (!blobLike) {
      if (typeof this.BlobClass !== "function") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/blob",
          "This host cannot wrap Mixamo bytes in a Blob",
        );
      }
      blob = new this.BlobClass([local], { type: localMediaType });
    }
    const url = this.createObjectURL(blob);
    return {
      kind: "local",
      url,
      fileName: localFileName,
      mediaType: localMediaType,
      revoke: () => this.revokeObjectURL(url),
    };
  }

  async loadContainerAsset(app, prepared) {
    if (prepared.asset) {
      const asset = prepared.asset;
      if (asset.loaded && asset.resource) return { asset, owned: false };
      const registry = app.assets;
      if (typeof registry.load !== "function") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/app",
          "PlayCanvas asset registry cannot load container assets",
        );
      }
      const current = typeof registry.get === "function" && asset.id !== undefined
        ? registry.get(asset.id)
        : null;
      if (!current && typeof registry.add === "function") registry.add(asset);
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          asset.off?.("error", onError);
          callback(value);
        };
        const onError = (error) => finish(
          reject,
          loadFailure(`Unable to load PlayCanvas container asset ${asset.name ?? prepared.fileName}`, error),
        );
        asset.once?.("error", onError);
        if (typeof asset.ready === "function") {
          asset.ready(() => finish(resolve));
        } else if (typeof asset.once === "function") {
          asset.once("load", () => finish(resolve));
        } else {
          finish(reject, new PlayCanvasMixamoCharacterHostError(
            "mixamo/asset-events",
            "PlayCanvas container asset cannot report when loading completes",
          ));
          return;
        }
        registry.load(asset);
      });
      if (!asset.resource) {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/container-resource",
          `PlayCanvas asset ${asset.name ?? prepared.fileName} loaded without a container resource`,
        );
      }
      return { asset, owned: false };
    }

    if (typeof app.assets.loadFromUrlAndFilename !== "function") {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/app",
        "PlayCanvas asset registry cannot load a container from a URL",
      );
    }
    const asset = await new Promise((resolve, reject) => {
      app.assets.loadFromUrlAndFilename(
        prepared.url,
        prepared.fileName,
        "container",
        (error, loadedAsset) => {
          if (error || !loadedAsset) {
            if (loadedAsset) {
              try {
                unloadAsset(app, loadedAsset);
              } catch {
                // The load failure remains the primary error.
              }
            }
            reject(loadFailure(
              `Unable to load Mixamo container ${prepared.fileName}`,
              error ?? "PlayCanvas returned no asset",
              { url: prepared.kind === "url" ? safeSourceUrl(prepared.url) : null },
            ));
            return;
          }
          resolve(loadedAsset);
        },
      );
    });
    return { asset, owned: true };
  }

  autoplayRequest(value, assigned) {
    if (!value) return null;
    if (value === true) {
      const clipId = assigned[0]?.id;
      return clipId ? { clipId, options: {} } : null;
    }
    if (typeof value === "string") {
      return { clipId: requiredString(value, "Mixamo autoplay clip"), options: {} };
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      return {
        clipId: requiredString(value.clipId ?? value.clip, "Mixamo autoplay clip"),
        options: {
          blend: value.blend,
          speed: value.speed,
          layer: value.layer,
        },
      };
    }
    throw new TypeError("Mixamo autoplay must be false, true, a clip id, or an autoplay descriptor");
  }
}

export function createPlayCanvasMixamoCharacterHost(options) {
  return new PlayCanvasMixamoCharacterHost(options);
}
