import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("demo areas lead with real captures and use artwork only as enhancement", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const media = fs.readFileSync(
    new URL("../public/hodos-demo-media.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /hodos-visual-language\.css/);
  assert.match(html, /hodos-demo-media\.css/);

  for (const capture of [
    "demo-world-editor.png",
    "demo-studio.png",
    "demo-playbot-world.png",
    "demo-apartment-world.png",
    "demo-guided-showcase.png",
  ]) {
    assert.ok(
      fs.existsSync(new URL(`../public/${capture}`, import.meta.url)),
      `${capture} should be checked in`,
    );
    assert.match(media, new RegExp(capture.replace(".", "\\.")));
  }

  assert.match(media, /var\(--hodos-demo-editor\)/);
  assert.match(media, /var\(--hodos-demo-studio\)/);
  assert.match(media, /var\(--hodos-demo-playbot\)/);
  assert.match(media, /var\(--hodos-demo-apartment\)/);
  assert.match(media, /var\(--hodos-demo-guide\)/);

  const enhancementOpacities = [...media.matchAll(/opacity:\s*(0\.0\d+)/g)]
    .map((match) => Number(match[1]));
  assert.ok(enhancementOpacities.length >= 6);
  assert.ok(enhancementOpacities.every((opacity) => opacity <= 0.075));
});
