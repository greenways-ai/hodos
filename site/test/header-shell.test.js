import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const shell = fs.readFileSync(
  new URL("../src/styles/starlight-shell.css", import.meta.url),
  "utf8",
);
const header = fs.readFileSync(
  new URL("../src/components/SharedSiteHeader.astro", import.meta.url),
  "utf8",
);

test("Hodos uses the same documentation-header geometry as Hoplite", () => {
  assert.match(header, /DocumentationHeader/);
  assert.match(shell, /--sl-nav-height:\s*76px/);
  assert.match(shell, /--sl-menu-button-size:\s*48px/);
  assert.match(
    shell,
    /\.header\s*\{[^}]*padding:\s*0;[^}]*border-bottom:\s*0;[^}]*background:\s*transparent;/s,
  );
  assert.match(
    shell,
    /\.header\s*>\s*\.gw-documentation-header\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*100%;[^}]*border-top:\s*0;/s,
  );
});

test("the responsive menu control retains Hoplite's shape", () => {
  assert.match(shell, /@media \(max-width:\s*49\.999rem\)/);
  assert.match(
    shell,
    /starlight-menu-button button\s*\{[^}]*width:\s*var\(--sl-menu-button-size\);[^}]*height:\s*var\(--sl-menu-button-size\);[^}]*border-radius:\s*10px;/s,
  );
  assert.match(shell, /--sl-nav-height:\s*68px/);
  assert.match(shell, /--sl-menu-button-size:\s*44px/);
});
