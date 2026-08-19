import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/tui.tsx", "src/cost.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: ["@opencode-ai/plugin", "@opentui/core", "@opentui/keymap", "@opentui/solid", "solid-js"],
})

if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exit(1)
}
