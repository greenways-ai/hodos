# @greenways/hodos-source-github

GitHub-backed world discovery and immutable repository graph resolution for
Hodos. It validates `project.edn`, resolves recursive world imports, and emits
asset URLs pinned to commit identities.

The package also defines a closed provider-backed world descriptor and semantic
launch intent. Repository data may request an installed provider, activity,
exact package coordinate and named state, but cannot supply an executable
factory, callback, source path, renderer object or capability. Provider mounting
remains an injected host responsibility and introduces no specialist-engine
dependency into Hodos.

`project.edn` parsing is browser-native. The package carries an ESM port of the
exact `edn-data@1.1.2` parser revision used by the monorepo, together with its
MIT notice. Browser consumers therefore do not need a Node resolver, CommonJS
loader, CDN, or application-specific import-map entry merely to inspect a world
manifest.

The add-on requires the host capability `network.github` and contributes
`world.source/github`.
