# Routes

The Vite panel is a single-entry React application without client-side routing.

| URL | Entry | Layout |
| --- | --- | --- |
| / | apps/panel/src/main.tsx | Page-local App shell |

apps/panel/index.html mounts #root and loads /src/main.tsx. Runtime state selects waiting, standalone connection, loading/error, or the active project panel. The active project panel is the primary target.

Actual HTML entry:

    <!doctype html>
    <html lang="zh-CN">
      <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Ambient Project Layer</title></head>
      <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
    </html>
