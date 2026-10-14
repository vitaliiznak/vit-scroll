import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { captureRunMetadata } from "./run-metadata.mjs";
import { build, preview } from "vite";
import { parseOptions, planRuns } from "./bench-options.mjs";
import { publishRun } from "./bench-publish.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
let server,
  child,
  interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
  if (child) child.kill("SIGINT");
});
import { reportHtml } from "./bench-report.mjs";
try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(
      `Usage: npm run bench -- [options]\n  --browser chromium,firefox,webkit  Default: chromium\n  --suite all|performance|memory  Default: all (performance = checks and timing; memory = Chromium heap)\n  --library all|window,tanstack,scaled,ag,virtuoso,virtua,rc,vit or adapter IDs (tanstack-scaled)\n  --profile all|default|best-effort  Default: all; minimal and strongest documented setups\n  --rows 100000,1000000  Default: both; maximum 100000000\n  --row-mode fixed|dynamic  Default: fixed\n  --repeats 3           Default: 3\n  --open                Open the saved HTML report\n  --no-publish          Keep results off the Benchmarks home page\n\nSetup browsers once: npm run bench:install\nMemory suite supports Chromium only. Each case uses a fresh browser process.\nBuild and isolated production server start automatically. Reports: output/bench/<timestamp>/.\nResults are also published to public/bench/ for the results home page /.`,
    );
  } else {
    // Launch preflight avoids spending time on a build or partial matrix when a browser is missing.
    for (const name of options.browsers) {
      let browser;
      try {
        browser = await { chromium, firefox, webkit }[name].launch({
          headless: true,
        });
      } catch (e) {
        throw new Error(
          `${name} could not launch. Run: npm run bench:install\n${e.message}`,
        );
      } finally {
        await browser?.close();
      }
    }
    if (interrupted) throw new Error("Interrupted.");
    const out = path.resolve(
      "output/bench",
      new Date().toISOString().replaceAll(":", "-"),
    );
    fs.mkdirSync(out, { recursive: true });
    const metadata = captureRunMetadata();
    fs.writeFileSync(
      path.join(out, "run.json"),
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          options: {
            browsers: options.browsers,
            suite: options.suite,
            rowMode: options.rowMode,
            profile: options.profile,
            engines: options.engines,
            counts: options.counts,
            repetitions: options.repetitions,
          },
          plan: planRuns(options),
          ...metadata,
        },
        null,
        2,
      ) + "\n",
    );
    const dist = path.join(out, "site");
    await build({ build: { outDir: dist, emptyOutDir: true } });
    server = await preview({
      build: { outDir: dist },
      preview: { host: "127.0.0.1", port: 0, open: false },
    });
    const address = server.httpServer.address();
    const base = `http://127.0.0.1:${address.port}`;
    const reports = [];
    for (const { browser: name, suite } of planRuns(options)) {
      if (interrupted) break;
      const file = `${name}-${suite}.json`;
      console.log(
        `\n${name} · ${suite} · ${options.engines.length * options.counts.length * options.repetitions} fresh-browser cases`,
      );
      await new Promise((resolve, reject) => {
        child = spawn(process.execPath, ["scripts/audit.mjs"], {
          stdio: "inherit",
          env: {
            ...process.env,
            AUDIT_BROWSER: name,
            AUDIT_SUITE: suite,
            AUDIT_ROW_MODE: options.rowMode,
            AUDIT_URL: base,
            AUDIT_COUNTS: options.counts.join(","),
            AUDIT_ENGINES: options.engines.join(","),
            AUDIT_REPEATS: String(options.repetitions),
            AUDIT_OUTPUT: path.join(out, file),
            AUDIT_RUN_METADATA: path.join(out, "run.json"),
          },
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          child = null;
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `Runner exited ${code}; partial results remain in ${out}`,
                ),
              );
        });
      });
      reports.push({
        ...JSON.parse(fs.readFileSync(path.join(out, file), "utf8")),
        file,
      });
      fs.writeFileSync(
        path.join(out, "report.html"),
        reportHtml(reports, options.suite, metadata),
      );
      // Publish after each browser so an interrupted matrix still shows as partial.
      if (options.publish) publishRun(out);
    }
    if (interrupted) throw new Error(`Interrupted. Saved results: ${out}`);
    const reportPath = path.join(out, "report.html");
    console.log(
      `\nReport: ${pathToFileURL(reportPath).href}\nRaw data: ${out}`,
    );
    if (options.publish)
      console.log(
        "Results page: npm run build && npm run preview, then open http://127.0.0.1:4173/ (npm run dev shows it without a rebuild).",
      );
    if (options.open) {
      const opener = spawn(
        process.platform === "darwin" ? "open" : "xdg-open",
        [reportPath],
        { stdio: "ignore" },
      );
      opener.on("error", (e) =>
        console.error(`Open ${reportPath} manually: ${e.message}`),
      );
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
