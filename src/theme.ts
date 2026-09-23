// The one place TRUBBL's colours, type and furniture are defined. Both the
// public rules page and the admin portal pull this in, so changing a token
// here moves both surfaces at once.
//
// Palette is "Deep Pitch": green-tinted surfaces all the way down, with a
// brighter green carrying the accent. Dark is the base; light is an override
// so that a reader who prefers it gets a page they can sit with for an hour.

const DARK = `
  --bg: #0a1410; --panel: #102019; --panel-2: #16291f; --line: #1f3629;
  --ink: #e6f0e8; --muted: #7f9c8c; --accent: #6ec97f; --on-accent: #052015;
  --hot: #e0684d; --ok: #6ec97f; --tint: rgba(110, 201, 127, 0.10);
  --hot-tint: rgba(224, 104, 77, 0.12); --shadow: rgba(0, 0, 0, 0.4);
`;

const LIGHT = `
  --bg: #f2f7f2; --panel: #e5efe7; --panel-2: #dbe8dd; --line: #cfe0d3;
  --ink: #101c15; --muted: #55705f; --accent: #1f6e48; --on-accent: #f2fbf5;
  --hot: #aa402c; --ok: #1f6e48; --tint: rgba(31, 110, 72, 0.10);
  --hot-tint: rgba(170, 64, 44, 0.08); --shadow: rgba(16, 28, 21, 0.12);
`;

export const FONT_LINKS = String.raw`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

// data-theme on <html> beats the system preference, so a reader can override
// it and we can remember the choice. Without it, the system decides.
export const THEME_CSS = `
:root {${DARK}
  --radius: 8px;
  --display: 400 1em/1 "Bebas Neue", "Haettenschweiler", Impact, sans-serif;
  --body: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {${LIGHT}
    color-scheme: light;
  }
}
:root[data-theme="light"] {${LIGHT}
  color-scheme: light;
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 400 16px/1.6 var(--body);
}
::selection { background: var(--accent); color: var(--on-accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

h1, h2, h3, .display {
  font: var(--display); letter-spacing: 0.04em; margin: 0; color: var(--ink);
}
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { text-decoration-thickness: 2px; }
p { margin: 0 0 14px; }
hr { border: 0; border-top: 1px solid var(--line); margin: 28px 0; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }

/* The league's name, with the joke intact: the I is struck through on purpose,
   because "Undependent" is the whole point of the acronym. */
.wordmark { font: var(--display); font-size: clamp(38px, 7vw, 66px); letter-spacing: 0.05em; }
.wordmark .acc { color: var(--accent); }
.expand { color: var(--muted); font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; margin: 8px 0 0; }
.expand s { text-decoration-thickness: 2px; text-decoration-color: var(--accent); }

.eyebrow {
  font: var(--display); font-size: 15px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--accent);
}

.panel, .card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 16px;
}
.callout {
  background: var(--panel); border-left: 3px solid var(--accent);
  border-radius: var(--radius); padding: 14px 18px; margin: 18px 0;
}
.callout .shout {
  font: var(--display); font-size: 22px; letter-spacing: 0.05em;
  color: var(--accent); margin: 0 0 6px;
}
.callout p:last-child { margin-bottom: 0; }

table { width: 100%; border-collapse: collapse; font-size: 15px; margin: 4px 0 20px; }
caption {
  text-align: left; font: var(--display); font-size: 15px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); padding-bottom: 8px;
}
th {
  text-align: left; font-family: var(--body); font-size: 11px; font-weight: 600;
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted);
  padding: 8px 10px; border-bottom: 2px solid var(--line);
}
td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.lead td { background: var(--tint); }
tr.lead td:first-child { box-shadow: inset 3px 0 0 var(--accent); }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 12px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 13px 14px; }
.tile .n { font: var(--display); font-size: 32px; letter-spacing: 0.03em; }
.tile .k { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-top: 5px; }
.tile.warn .n { color: var(--hot); }
.tile.good .n { color: var(--accent); }

.pill {
  display: inline-block; font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
}
.pill.open, .pill.ok { color: var(--ok); border-color: var(--ok); }
.pill.soon { color: var(--accent); border-color: var(--accent); }
.pill.overdue, .pill.late { color: var(--hot); border-color: var(--hot); background: var(--hot-tint); }

button, .btn {
  font: inherit; font-size: 14px; padding: 7px 14px; border-radius: var(--radius);
  cursor: pointer; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
}
button:hover, .btn:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 700; }
button.danger { border-color: var(--hot); color: var(--hot); background: transparent; }
button[disabled] { opacity: 0.5; cursor: default; }

input, select, textarea {
  background: var(--bg); color: var(--ink); border: 1px solid var(--line);
  border-radius: 6px; padding: 7px 9px; font: inherit; font-size: 14px;
}
label { display: block; margin-bottom: 10px; font-size: 13px; color: var(--muted); }
label input, label select { display: block; margin-top: 4px; width: 100%; max-width: 320px; }

.muted { color: var(--muted); }
.note { color: var(--muted); font-size: 13.5px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.stack > * + * { margin-top: 16px; }
`;
