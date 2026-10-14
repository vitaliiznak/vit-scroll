import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Recorded results (home), the live demo, a redirect for old results links,
// and a browsable copy of the local source.
const page = (file) => fileURLToPath(new URL(file, import.meta.url));
const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_PAGES === "true" && repository ? `/${repository}/` : "/";
export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: {
        benchmarks: page("./index.html"),
        demo: page("./demo.html"),
        legacy: page("./benchmarks.html"),
        source: page("./source.html"),
      },
    },
  },
});
