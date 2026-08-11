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

The add-on requires the host capability `network.github` and contributes
`world.source/github`.
