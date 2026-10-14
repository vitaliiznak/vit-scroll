import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPublishedRun, updateManifest } from "../src/bench-results.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const PUBLIC_BENCH = path.join(root, "public/bench");

const isBrowserReport = (name) => /^(chromium|firefox|webkit)-\w+\.json$/.test(name);

// Artifact downloads nest each run directory. A directory is one run when it
// holds the browser JSON; its build output is not searched.
export function findRunDirs(root) {
  const found = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && isBrowserReport(entry.name))) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(path.join(dir, entry.name));
    }
  };
  if (root && fs.existsSync(root)) visit(root);
  return found.sort();
}

export function readRun(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => isBrowserReport(f));
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
  const args = process.argv.slice(2);
  const usage =
    "Usage: npm run bench:publish -- output/bench/<timestamp> [...more]\n       npm run bench:publish -- --scan <directory>\nWrites public/bench/runs/<id>.json and public/bench/index.json for the results home page (/).";
  if (!args.length || args.includes("--help")) {
    console.log(usage);
  } else {
    try {
      const dirs =
        args[0] === "--scan"
          ? findRunDirs(path.resolve(args[1] ?? ""))
          : args.map((dir) => path.resolve(dir));
      if (args[0] === "--scan" && !args[1]) throw new Error(usage);
      if (!dirs.length) console.log("No benchmark JSON to publish.");
      for (const dir of dirs) {
        const run = publishRun(dir);
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
