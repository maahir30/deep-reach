import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  // Shebang is preserved from src/cli/index.ts by tsup automatically
  // tsup reads tsconfig.json paths for alias resolution
});
