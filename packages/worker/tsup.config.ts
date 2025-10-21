import { defineConfig } from "tsup";

export default defineConfig({
  // Main package entry with declarations
  entry: { "index": "src/index.ts" },
  format: ["esm"],
  platform: "neutral",
  sourcemap: true,
  dts: true,
  outDir: "dist",
  treeshake: true,
  minify: false,
  external: ["@app/db", "@app/proto", "@app/agent"]
});