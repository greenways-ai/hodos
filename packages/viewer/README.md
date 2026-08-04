# @greenways/hodos-viewer

The thin browser shell for Hodos Worlds. It composes a registered world source
and renderer into `viewer/worlds`, hosts classical surfaces, and forwards
semantic effects without owning GitHub, PlayCanvas, authoring, or publication
implementation details.

The shell add-on depends only on Core and accepts the single active
`world.source` and `world.renderer` contributions. Install
`@greenways/hodos-viewer-defaults` for the first-party GitHub and PlayCanvas
composition.

The base distribution is read-only. Activate `@greenways/hodos-ui-world-authoring`
and/or `@greenways/hodos-ui-world-publication` before creating a viewer to add
those panels. World models and source-specific APIs are imported from their
owning packages rather than through the shell.
