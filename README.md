# Hodos

Hodos is an open-world kernel and browser viewer. A repository describes a
world with `project.edn`; the Hara kernel resolves its bundle and locked
packages, and the viewer renders its Gaussian-splat scene.

The repository deliberately separates reusable technology from presentation:

- `packages/kernel` owns the `gw.hodos.*` HAL surface, bundling, package plans,
  and scene commands.
- `packages/viewer` is an embeddable browser viewer with no featured-world or
  landing-page policy.
- `apps/demo` is the Hodos Worlds demonstration using public repositories from
  [greenways-worlds](https://github.com/greenways-worlds).

## Development

```sh
npm install
npm test
npm run build
```

Scene editing, attached scripts, and spatial audio will be separate packages
that consume the same kernel and viewer contracts.
