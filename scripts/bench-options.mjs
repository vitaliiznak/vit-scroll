import { ADAPTERS, ENGINES, PROFILES, selectAdapters } from "../src/engines.mjs";
export function parseOptions(args) {
  const options = {
    browser: "chromium",
    suite: "all",
    library: "all",
    profile: "all",
    rows: "100000,1000000",
    repeats: "3",
    "row-mode": "fixed",
    open: false,
    publish: true,
  };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (
      !args[i].startsWith("--") ||
      ![
        "browser",
        "suite",
        "library",
        "profile",
        "rows",
        "row-mode",
        "repeats",
        "open",
        "no-publish",
        "help",
      ].includes(key)
    )
      throw new Error(`Unknown option: ${args[i]}`);
    if (key === "open" || key === "help") {
      options[key] = true;
      continue;
    }
    if (key === "no-publish") {
      options.publish = false;
      continue;
    }
    if (!args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`Missing value for --${key}`);
    options[key] = args[++i];
  }
  if (options.help) return options;
  options.rowMode = options["row-mode"];
  if (!["fixed", "dynamic"].includes(options.rowMode))
    throw new Error("--row-mode must be fixed or dynamic.");
  options.browsers = [...new Set(options.browser.split(","))];
  if (
    options.browsers.some((x) => !["chromium", "firefox", "webkit"].includes(x))
  )
    throw new Error("--browser must be chromium,firefox,webkit (one or more).");
  if (!["all", "performance", "memory"].includes(options.suite))
    throw new Error("--suite must be all, performance or memory.");
  if (
    options.suite === "memory" &&
    options.browsers.some((x) => x !== "chromium")
  )
    throw new Error(
      "Heap measurements require --browser chromium. Use --suite performance for Firefox and WebKit.",
    );
  options.profiles =
    options.profile === "all" ? PROFILES : [options.profile];
  if (options.profiles.some((x) => !PROFILES.includes(x)))
    throw new Error("--profile must be all, default or best-effort.");
  const requested =
    options.library === "all"
      ? ENGINES.map((x) => x.id)
      : [...new Set(options.library.split(","))];
  if (requested.some((x) => !ADAPTERS.some((a) => a.id === x || a.engine === x)))
    throw new Error(
      `--library expects all, library IDs (${ENGINES.map((x) => x.id).join(",")}) or adapter IDs (${ADAPTERS.map((x) => x.id).join(",")}).`,
    );
  // Benchmark targets are adapters: a library in one configuration profile.
  options.engines = selectAdapters(requested, options.profiles);
  if (!options.engines.length)
    throw new Error(
      `No adapter of ${requested.join(",")} belongs to --profile ${options.profile}.`,
    );
  options.counts = [...new Set(options.rows.split(",").map(Number))];
  if (
    options.counts.some(
      (x) => !Number.isSafeInteger(x) || x < 1000 || x > 100_000_000,
    )
  )
    throw new Error("--rows must contain integers between 1000 and 100000000.");
  options.repetitions = Number(options.repeats);
  if (
    !Number.isInteger(options.repetitions) ||
    options.repetitions < 1 ||
    options.repetitions > 20
  )
    throw new Error("--repeats must be an integer from 1 to 20.");
  return options;
}

export function planRuns(options) {
  return options.browsers.flatMap((browser) =>
    (options.suite === "all"
      ? ["performance", ...(browser === "chromium" ? ["memory"] : [])]
      : [options.suite]
    ).map((suite) => ({ browser, suite })),
  );
}
