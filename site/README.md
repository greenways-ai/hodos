# Hodos site

The public Hodos specification site is an Astro + Starlight application modelled
after the Hoplite documentation shell, with a deliberately muted neutral
palette.

The canonical specification drafts remain in the repository root at `spec/`.
`scripts/sync-spec.mjs` creates Starlight content copies before development,
checking, or building.

```sh
npm install
npm run dev
npm run build
```

The repository Pages workflow builds the existing demo independently and copies
its output into `site/dist/demo/` after the Astro build.
