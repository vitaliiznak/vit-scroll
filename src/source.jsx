import React from "react";
import { createRoot } from "react-dom/client";
import { SiteHeader } from "./SiteHeader.jsx";
import "./style.css";
import "./source.css";

// Read the actual modules at build time; do not maintain duplicate source copies.
const files = import.meta.glob("../packages/vit-scroll/*", {
  query: "?raw",
  import: "default",
  eager: true,
});
const descriptions = {
  "core.mjs": "Framework-independent coordinate math",
  "react.jsx": "React container scrolling",
  "window.jsx": "React page scrolling",
};

createRoot(document.getElementById("root")).render(
  <>
    <SiteHeader page="source" />
    <main className="source-folder">
      <span className="eyebrow">VITSCROLL SOURCE FOLDER</span>
      <h1>packages/vit-scroll/</h1>
      <p>The local prototype’s source modules, included with this build. VitScroll is not published to npm.</p>
      {Object.entries(files).map(([path, source]) => {
        const name = path.split("/").pop();
        return (
          <details key={name}>
            <summary>{name}<span>{descriptions[name]}</span></summary>
            <pre><code>{source}</code></pre>
          </details>
        );
      })}
    </main>
  </>,
);
