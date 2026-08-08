# Explore a Hara project

This complete project is the Canvas for the `Explorer` package story.

The Showcase selects the immutable Playground `files` surface. The live
Playground source service supplies the file tree; the Gallery State panel shows
the equivalent serializable `hodos.dev/explorer` area model.

The Explorer model does not read or mutate files itself. Selection, expansion,
filtering and operation requests are semantic events resolved by the owning
source service.
