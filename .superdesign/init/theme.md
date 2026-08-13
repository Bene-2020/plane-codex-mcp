# Theme

## Compact token summary

- Font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif.
- Canvas: warm radial gradient from #fffaf3 into #f4f0eb.
- Surfaces: #fffdf9; borders: #e6ded5 to #e7e0d8.
- Text: primary #27231f, secondary #6d645c, muted #958c82.
- Accent: #a8673f and #bd815a with pale selection #f8e9dc.
- Semantics: success #367052/#e4f2e8; danger #a1493e/#f7e4df; warning #8c5a35/#f8e8d7.
- Radius: 4px badges, 8-9px controls, 12px item cards, 22px session cards, pill 99px.
- Shadows: item 0 2px 6px #49301805; session 0 20px 60px #51433112.
- Desktop minimum: 1040px. Main grid: 205px minmax(380px, 1fr) minmax(360px, 39%).
- No dark theme, Tailwind config, or theme provider.

## Raw source

The complete visual source is apps/panel/src/styles.css (17 physical lines, under the 900-line context threshold). Key actual rules:

    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #27231f; background: #f4f0eb; font-synthesis: none; }
    body { margin: 0; min-width: 1040px; }
    .shell { min-height: 100vh; background: radial-gradient(circle at 72% -20%, #fffaf3 0, #f4f0eb 48%); }
    .layout { display: grid; grid-template-columns: 205px minmax(380px, 1fr) minmax(360px, 39%); min-height: calc(100vh - 118px); }
    .item { display: block; padding: 15px 16px; border: 1px solid #e7e0d8; border-radius: 12px; background: #fffdf9; box-shadow: 0 2px 6px #49301805; }
    .item.selected { border-color: #bd815a; box-shadow: 0 0 0 2px #bd815a22; }

Always pass the full apps/panel/src/styles.css file to design commands.
