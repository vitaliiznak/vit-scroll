import React from "react";
import { ENGINES } from "./engines.mjs";

// Pass the recorded version on results pages, not the current demo version.
export function LibraryLinks({ id, version = ENGINES.find((e) => e.id === id)?.version }) {
  const library = ENGINES.find((e) => e.id === id);
  if (!library) return null;
  return (
    <span className="library-links">
      <a
        href={library.repository ?? `${import.meta.env.BASE_URL}source.html`}
        target="_blank"
        rel="noreferrer"
        aria-label={`${library.name} ${library.repository ? "repository" : "source folder"}`}
        title={library.repository ?? "Browse packages/vit-scroll/"}
      >
        {library.repository ? "Repo" : "Source folder"} ↗
      </a>
      <span aria-hidden="true">·</span>
      {version && library.package ? (
        <a
          href={`https://www.npmjs.com/package/${library.package}/v/${encodeURIComponent(version)}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`${library.name} version ${version} on npm`}
        >
          v{version} ↗
        </a>
      ) : (
        <span>{version ? `v${version} · local prototype` : "Version not recorded"}</span>
      )}
    </span>
  );
}
