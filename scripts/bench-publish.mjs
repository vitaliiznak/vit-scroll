import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPublishedRun, updateManifest } from "../src/bench-results.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const PUBLIC_BENCH = path.join(root, "public/bench");

export function readRun(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^(chromium|firefox|webkit)-\w+\.json$/.test(f));
  if (!files.length) throw new Error(`No benchmark JSON in ${dir}`);
  const metaFile = path.join(dir, "run.json");
  const meta = fs.existsSync(metaFile)
    ? JSON.parse(fs.readFileSync(metaFile, "utf8"))
    : {};
  const order = meta.options?.browsers ?? ["chromium", "firefox", "webkit"];
  const reports = files
    .map((file) => {
      const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      return { ...report, browser: file.split("-")[0] };
    })
    .sort((a, b) => order.indexOf(a.browser) - order.indexOf(b.browser));
  const suite = meta.options?.suite ?? reports[0].config?.suite;
  const id = `${path.basename(dir)}-${suite}`;
  return buildPublishedRun({ id, meta, reports });
}

// Publishes one output/bench/<timestamp>/ directory to public/bench/ so the
// results home page (/) can load it. Raw JSON stays in output/.
export function publishRun(dir, { publicDir = PUBLIC_BENCH } = {}) {
  const run = readRun(dir);
  const id = run.id;
  fs.mkdirSync(path.join(publicDir, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(publicDir, "runs", `${id}.json`),
    JSON.stringify(run) + "\n",
  );
  const indexFile = path.join(publicDir, "index.json");
  const previous = fs.existsSync(indexFile)
    ? JSON.parse(fs.readFileSync(indexFile, "utf8"))
    : null;
  const { dropped, ...manifest } = updateManifest(previous, run);
  for (const file of dropped)
    fs.rmSync(path.join(publicDir, file), { force: true });
  fs.writeFileSync(indexFile, JSON.stringify(manifest, null, 2) + "\n");
  return run;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2);
  if (!dirs.length || dirs.includes("--help")) {
    console.log(
      "Usage: npm run bench:publish -- output/bench/<timestamp> [...more]\nWrites public/bench/runs/<id>.json and public/bench/index.json for the results home page (/).",
    );
  } else {
    try {
      for (const dir of dirs) {
        const run = publishRun(path.resolve(dir));
        console.log(
          `Published ${run.id}: ${run.cases.length} cases${run.complete ? "" : " (partial)"}`,
        );
      }
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  }
}
