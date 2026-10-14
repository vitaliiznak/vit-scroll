import React from "react";

const BASE = import.meta.env.BASE_URL;
export const BENCHMARKS_URL = BASE;
export const DEMO_URL = `${BASE}demo.html`;

// The published results (/), the demo with its library table (/demo.html)
// and the source folder share this header.
export function SiteHeader({ page = "benchmarks" }) {
  const demo = page === "demo";
  const links = [
    ["Benchmarks", BENCHMARKS_URL, page === "benchmarks"],
    ["Demo", DEMO_URL, demo],
  ];
  return (
    <header className="site-header">
      <a href={BASE} className="brand">
        <span className="brand-mark">↕</span>scroll<span>bench</span>
      </a>
      <nav>
        {links.map(([label, href, current]) => (
          <a
            key={label}
            href={href}
            aria-current={current ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <span className="local-badge">
        <i /> {demo ? "Runs on your device" : page === "source" ? "Local source" : "Recorded results"}
      </span>
    </header>
  );
}
