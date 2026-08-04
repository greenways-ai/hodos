# @greenways/hodos-world-model

Runtime-neutral world primitives for Hodos. The package owns entity,
selection, authoring, draft, animation, prefab, and typed drag models without
depending on a renderer, DOM shell, network source, or Hara runtime.

The add-on contributes `world.model/authoring`; direct subpath exports remain
available to renderers and UI packages that need individual model modules.
