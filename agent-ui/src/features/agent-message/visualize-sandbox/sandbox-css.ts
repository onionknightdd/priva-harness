export const VISUALIZE_SANDBOX_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
].join("; ")

export const VISUALIZE_SANDBOX_IFRAME = {
  sandbox: "allow-scripts",
  referrerPolicy: "no-referrer" as const,
  allow: "",
}

export const VISUALIZE_SANDBOX_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
button, input, select, textarea { font: inherit; }
#root { min-height: 0; }
.vs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  height: 2.25rem;
  padding: 0 0.625rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 500;
  cursor: pointer;
}
.vs-btn:hover { filter: brightness(1.08); }
.vs-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.vs-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.vs-btn-outline { background: var(--background); color: var(--foreground); border-color: var(--border); }
.vs-btn-secondary { background: var(--secondary); color: var(--secondary-foreground); }
.vs-btn-ghost { background: transparent; color: var(--foreground); }
.vs-btn-destructive { background: var(--destructive); color: var(--primary-foreground); }
.vs-badge {
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.5rem;
  border-radius: 999px;
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: 12px;
  font-weight: 500;
}
.vs-badge-secondary { background: var(--secondary); color: var(--secondary-foreground); }
.vs-badge-outline { background: transparent; color: var(--foreground); border: 1px solid var(--border); }
.vs-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 0;
  border-radius: 0.75rem;
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  outline: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent);
}
.vs-card-header, .vs-card-content { padding: 0 1.25rem; display: flex; flex-direction: column; gap: 0.35rem; }
.vs-card-title { font-weight: 600; font-size: 1rem; }
.vs-card-description { color: var(--muted-foreground); font-size: 0.875rem; }
.vs-progress {
  display: block;
  height: 0.375rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--muted);
}
.vs-progress-bar { height: 100%; background: var(--primary); }
.vs-separator { height: 1px; border: 0; background: var(--border); margin: 0; }
`.trim()

const THEME_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
] as const

export function readVisualizeThemeCss(): string {
  if (typeof document === "undefined") {
    return ""
  }
  const style = getComputedStyle(document.documentElement)
  const decls = THEME_VARS.map((name) => {
    const value = style.getPropertyValue(name).trim()
    return value === "" ? "" : `${name}: ${value};`
  })
    .filter(Boolean)
    .join(" ")
  const dark = document.documentElement.classList.contains("dark")
  return `:root { ${decls} color-scheme: ${dark ? "dark" : "light"}; }`
}
