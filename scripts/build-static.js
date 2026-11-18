/**
 * Static export for GitHub Pages.
 * ------------------------------------------------------------
 * Renders every route through the same pipeline as the dev server
 * (server.js renderPage), copies the public assets, injects the
 * hosted Supabase config + a non-localhost guard (no live-reload
 * EventSource on the public site), and emits a 404.html that sends
 * extensionless misses to their directory index.
 *
 * Run:  node scripts/build-static.js         (from the repo root)
 * Env:  SUPABASE_URL, SUPABASE_ANON_KEY      (baked into every page)
 * Out:  frontend/dist/
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const PUBLIC = path.join(FRONTEND, 'public');
const DIST = path.join(FRONTEND, 'dist');

const { renderPage, PAGE_ROUTES } = require(path.join(FRONTEND, 'server.js'));

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[build] SUPABASE_URL and SUPABASE_ANON_KEY are required');
  process.exit(1);
}

/* Route path -> output file. Directory indexes keep the URLs
 * extensionless (github.io/favorites serves favorites/index.html). */
const TARGETS = {
  '/': 'index.html',
  '/welcome': 'welcome/index.html',
  '/login': 'login/index.html',
  '/signup': 'signup/index.html',
  '/favorites': 'favorites/index.html',
  '/groups': 'groups/index.html',
  '/settings': 'settings/index.html',
};

/* Injected before </head>: marks the page as hosted (auth.js switches to
 * Supabase-direct calls) and drops the dev-server live-reload channel. */
const GUARD =
  '<script>window.__CB_HOSTED__=' +
  JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY }) +
  ';(function(){try{if(!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname)){delete window.EventSource;}}catch(e){}})();</script>';

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Page not found - Contact Book</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f4ec; color: #1f1d1a; font-family: Inter, system-ui, sans-serif; }
    main { padding: 2rem; text-align: center; }
    p { color: #7a756b; }
    a { color: #1a73e8; }
  </style>
  <script>
    // GitHub Pages has no router: known extensionless paths404 until we
    // forward them to their directory index (favorites -> favorites/).
    (function () {
      var known = ['', '/welcome', '/login', '/signup', '/favorites', '/groups', '/settings'];
      var p = location.pathname.replace(/\\/+$/, '');
      if (known.indexOf(p) !== -1) location.replace(p + '/' + location.search);
    })();
  </script>
</head>
<body>
  <main>
    <h1>404 - page not found</h1>
    <p>That page is not part of the contact book.</p>
    <p><a href="/">Back to contacts</a></p>
  </main>
</body>
</html>
`;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    // templates are only meaningful to the server-side renderer
    if (entry.name === 'pages' || entry.name === 'partials' || entry.name === 'layout.html') {
      continue;
    }
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(PUBLIC, DIST);

  for (const [route, target] of Object.entries(TARGETS)) {
    const config = PAGE_ROUTES[route];
    if (!config) {
      console.error('[build] unknown route ' + route);
      process.exit(1);
    }
    let html = renderPage(config);
    html = html.replace('</head>', '  ' + GUARD + '\n</head>');
    const out = path.join(DIST, target);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    console.log('[build] ' + route + ' -> ' + path.relative(DIST, out).replace(/\\/g, '/'));
  }

  fs.writeFileSync(path.join(DIST, '404.html'), NOT_FOUND_HTML);
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  console.log('[build] done -> ' + path.relative(ROOT, DIST).replace(/\\/g, '/'));
}

main();
