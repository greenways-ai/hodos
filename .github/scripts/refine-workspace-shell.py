from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "packages/workspace-ui/src/shell.js"
source = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    source = source.replace(old, new, 1)


replace_once(
'''const derivedResponsiveSurfaces = (areas, layoutIds) => areas
  .filter((area) => area.presentation.compact)
  .map((area, index) => Object.freeze({
    id: area.presentation.surfaceId ?? area.id,
    areaId: area.id,
    label: area.presentation.label,
    icon: area.presentation.icon,
    mode: area.presentation.mode,
    order: area.presentation.order || layoutIds.indexOf(area.id) || index,
    autoFocus: area.presentation.autoFocus,
  }))
  .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
''',
'''const derivedResponsiveSurfaces = (areas, layoutIds) => areas
  .filter((area) => area.presentation.compact)
  .map((area, index) => {
    const layoutIndex = layoutIds.indexOf(area.id);
    const order = area.presentation.order !== 0
      ? area.presentation.order
      : layoutIndex >= 0 ? layoutIndex : index;
    return Object.freeze({
      id: area.presentation.surfaceId ?? area.id,
      areaId: area.id,
      label: area.presentation.label,
      icon: area.presentation.icon,
      mode: area.presentation.mode,
      order,
      autoFocus: area.presentation.autoFocus,
    });
  })
  .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
''',
"derived responsive surface order",
)

replace_once(
'''  const surfaces = raw?.length
    ? raw.map((surface, index) => responsiveSurfaceValue(surface, index, areaById))
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    : derivedResponsiveSurfaces(areas, layoutIds);
''',
'''  const surfaces = raw != null
    ? raw.map((surface, index) => responsiveSurfaceValue(surface, index, areaById))
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    : derivedResponsiveSurfaces(areas, layoutIds);
''',
"explicit empty responsive surfaces",
)

replace_once(
'''    fallbackAreaId,
    responsive.defaultSurfaceId,
  );
''',
'''    fallbackAreaId,
    null,
  );
''',
"selection surface fallback",
)

replace_once(
'''  #adoptSelection(next) {
    if (next.selection.surfaceId) this.surfaceId = next.selection.surfaceId;
    else if (this.lastSelectionAreaId && this.lastSelectionAreaId !== next.selection.areaId) {
      this.surfaceId = next.responsive.surfaces.find((surface) =>
        surface.areaId === next.selection.areaId)?.id ?? next.responsive.defaultSurfaceId;
    }
    this.lastSelectionAreaId = next.selection.areaId;
  }
''',
'''  #adoptSelection(next) {
    const workspaceChanged = this.workspace?.id !== next.id;
    if (workspaceChanged) {
      this.surfaceId = next.selection.surfaceId ?? null;
      this.preferenceLoadedFor = null;
      this.ratioOverrides.clear();
      this.loadedRatioPreferences.clear();
    } else if (next.selection.surfaceId) this.surfaceId = next.selection.surfaceId;
    else if (this.lastSelectionAreaId && this.lastSelectionAreaId !== next.selection.areaId) {
      this.surfaceId = next.responsive.surfaces.find((surface) =>
        surface.areaId === next.selection.areaId)?.id ?? next.responsive.defaultSurfaceId;
    }
    if (this.surfaceId && !next.responsive.surfaces.some((surface) => surface.id === this.surfaceId)) {
      this.surfaceId = null;
    }
    this.lastSelectionAreaId = next.selection.areaId;
  }
''',
"workspace selection adoption",
)

replace_once(
'''  #loadSurfacePreference() {
    if (!this.workspace || this.preferenceLoadedFor === this.workspace.id || this.surfaceId) return;
    this.preferenceLoadedFor = this.workspace.id;
    const preferred = safeCall(this.#workspaceService().readSurface, {
      workspaceId: this.workspace.id,
      surfaces: this.workspace.responsive.surfaces,
    });
    if (typeof preferred === "string" && this.workspace.responsive.surfaces.some((entry) => entry.id === preferred)) {
      this.surfaceId = preferred;
    }
  }
''',
'''  #loadSurfacePreference() {
    if (!this.workspace || this.preferenceLoadedFor === this.workspace.id || this.surfaceId) return;
    const workspaceId = this.workspace.id;
    this.preferenceLoadedFor = workspaceId;
    let preferred;
    try {
      preferred = this.#workspaceService().readSurface?.({
        workspaceId,
        surfaces: this.workspace.responsive.surfaces,
      });
    } catch (error) {
      this.#reportError(error);
      return;
    }
    const apply = (surfaceId) => {
      if (this.workspace?.id !== workspaceId) return;
      if (typeof surfaceId === "string"
        && this.workspace.responsive.surfaces.some((entry) => entry.id === surfaceId)) {
        this.surfaceId = surfaceId;
        this.#render();
      }
    };
    if (preferred?.then) Promise.resolve(preferred).then(apply).catch((error) => this.#reportError(error));
    else if (preferred != null) apply(preferred);
  }
''',
"surface preference reader",
)

replace_once(
'''  #ratioFor(layout) {
    if (this.ratioOverrides.has(layout.id)) return this.ratioOverrides.get(layout.id);
    if (!this.loadedRatioPreferences.has(layout.id)) {
      this.loadedRatioPreferences.add(layout.id);
      const preferred = safeCall(this.#workspaceService().readSplitRatio, {
        workspaceId: this.workspace?.id,
        layoutId: layout.id,
        ratio: layout.ratio,
      });
      if (Number.isFinite(Number(preferred))) {
        const ratio = clampRatio(preferred);
        this.ratioOverrides.set(layout.id, ratio);
        return ratio;
      }
    }
    return layout.ratio;
  }
''',
'''  #ratioFor(layout) {
    if (this.ratioOverrides.has(layout.id)) return this.ratioOverrides.get(layout.id);
    if (!this.loadedRatioPreferences.has(layout.id)) {
      this.loadedRatioPreferences.add(layout.id);
      const workspaceId = this.workspace?.id;
      let preferred;
      try {
        preferred = this.#workspaceService().readSplitRatio?.({
          workspaceId,
          layoutId: layout.id,
          ratio: layout.ratio,
        });
      } catch (error) {
        this.#reportError(error);
        return layout.ratio;
      }
      const apply = (value) => {
        if (this.workspace?.id !== workspaceId || !Number.isFinite(Number(value))) return;
        this.ratioOverrides.set(layout.id, clampRatio(value));
        this.#render();
      };
      if (preferred?.then) Promise.resolve(preferred).then(apply).catch((error) => this.#reportError(error));
      else if (Number.isFinite(Number(preferred))) {
        const ratio = clampRatio(preferred);
        this.ratioOverrides.set(layout.id, ratio);
        return ratio;
      }
    }
    return layout.ratio;
  }
''',
"split ratio preference reader",
)

replace_once(
'''    this.media = this.matchMedia(query);
    this.media?.addEventListener?.("change", this.mediaListener);
    this.media?.addListener?.(this.mediaListener);
  }

  #unbindMedia() {
    this.media?.removeEventListener?.("change", this.mediaListener);
    this.media?.removeListener?.(this.mediaListener);
''',
'''    this.media = this.matchMedia(query);
    if (typeof this.media?.addEventListener === "function") {
      this.media.addEventListener("change", this.mediaListener);
    } else this.media?.addListener?.(this.mediaListener);
  }

  #unbindMedia() {
    if (typeof this.media?.removeEventListener === "function") {
      this.media.removeEventListener("change", this.mediaListener);
    } else this.media?.removeListener?.(this.mediaListener);
''',
"media query listener lifecycle",
)

replace_once(
'''            dispatch: (event, meta) => {
              const payload = typeof event === "string" ? { "event/type": event } : { ...event };
              if (!Object.hasOwn(payload, "area/id")) payload["area/id"] = area.id;
              if (!Object.hasOwn(payload, "workspace/id")) payload["workspace/id"] = this.workspace.id;
              return this.dispatch(payload, { ...meta, workspace: this.workspace, area });
            },
''',
'''            dispatch: (event, meta) => {
              const currentArea = record.area;
              const payload = typeof event === "string" ? { "event/type": event } : { ...event };
              if (!Object.hasOwn(payload, "area/id")) payload["area/id"] = currentArea.id;
              if (!Object.hasOwn(payload, "workspace/id")) payload["workspace/id"] = this.workspace.id;
              return this.dispatch(payload, { ...meta, workspace: this.workspace, area: currentArea });
            },
''',
"current area event metadata",
)

PATH.write_text(source, encoding="utf-8")
for relative in (
    ".github/scripts/refine-workspace-shell.py",
    ".github/workflows/refine-workspace-shell.yml",
):
    target = ROOT / relative
    if target.exists():
        target.unlink()
