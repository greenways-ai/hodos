import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://oss.greenways.ai",
  base: "/hodos",
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      title: "Hodos",
      description: "The open specification boundary for web-native worlds.",
      logo: { src: "./public/sigil.svg", replacesTitle: false },
      favicon: "/hodos/favicon.svg",
      components: {
        Header: "./src/components/SharedSiteHeader.astro",
        ThemeProvider: "./src/components/GreenwaysThemeProvider.astro",
        ThemeSelect: "./src/components/GreenwaysThemeSelect.astro",
      },
      customCss: [
        "./src/styles/custom.css",
        "./src/styles/starlight-shell.css",
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/greenways-ai/hodos",
        },
      ],
      lastUpdated: true,
      pagefind: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: "Overview", slug: "index" },
        { label: "Architecture", slug: "architecture" },
        {
          label: "Specification",
          items: [
            { label: "Specification index", slug: "spec" },
            { label: "Core", slug: "spec/core" },
            { label: "World", slug: "spec/world" },
            { label: "Browser–Hara ABI", slug: "spec/host-abi" },
            { label: "Capabilities", slug: "spec/capabilities" },
            { label: "Engagement", slug: "spec/engagement" },
            { label: "Conformance", slug: "spec/conformance" },
            { label: "Web3 profile", slug: "spec/profiles/web3" },
          ],
        },
        {
          label: "Implementation",
          items: [
            { label: "Directory map", slug: "implementation/directory-map" },
            { label: "Reference stack", slug: "implementation/reference-stack" },
            { label: "Demo ↗", link: "/hodos/demo/" },
            {
              label: "Packages & add-ons ↗",
              link: "https://github.com/greenways-ai/hodos/blob/main/docs/packages-and-addons.md",
            },
          ],
        },
        {
          label: "Project",
          items: [
            {
              label: "Source ↗",
              link: "https://github.com/greenways-ai/hodos",
            },
            { label: "Greenways OSS ↗", link: "https://oss.greenways.ai/" },
            { label: "Hara ↗", link: "https://hara-lang.org" },
          ],
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content:
              "https://oss.greenways.ai/visual-language/assets/og-hodos.jpg",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:secure_url",
            content:
              "https://oss.greenways.ai/visual-language/assets/og-hodos.jpg",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:type",
            content: "image/jpeg",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:width",
            content: "1200",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:height",
            content: "630",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content: "The Hodos moth sigil over its mosaic theatre",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:card",
            content: "summary_large_image",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content:
              "https://oss.greenways.ai/visual-language/assets/og-hodos.jpg",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image:alt",
            content: "The Hodos moth sigil over its mosaic theatre",
          },
        },
      ],
    }),
    mdx(),
  ],
});
