/**
 * Personal Contact Book - Node.js dev server
 * ------------------------------------------------------------
 * 1. Serves the frontend            -> http://localhost:3000
 * 2. Proxies /api/* to Python API   -> http://127.0.0.1:8000
 * 3. Live-reloads the browser on change (SSE) so you can watch
 *    edits happen simultaneously while I work
 * 4. Auto-starts the Tailwind watcher and the Python API
 *    (uvicorn --reload) if they are not already running
 *
 * Run:  npm run dev        (from /frontend)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 8000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PARTIALS_DIR = path.join(PUBLIC_DIR, 'partials');
const PAGES_DIR = path.join(PUBLIC_DIR, 'pages');
const BACKEND_DIR = path.join(ROOT, '..', 'backend');
const CHILDREN = [];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ live reload */
const liveClients = new Set();
let notifyTimer = null;

function broadcast(file) {
  const ext = path.extname(file || '').toLowerCase();
  // CSS can be hot-swapped without losing state; anything else reloads.
  const payload = ext === '.css' ? `css:${file}` : 'reload';
  for (const res of liveClients) res.write(`data: ${payload}\n\n`);
}

function watchPublic() {
  try {
    fs.watch(PUBLIC_DIR, { recursive: true }, (_event, file) => {
      if (!file) return;
      clearTimeout(notifyTimer);
      notifyTimer = setTimeout(() => broadcast(file), 120);
    });
    console.log('[watch] public/ -> live reload armed');
  } catch (err) {
    console.warn('[watch] unavailable:', err.message);
  }
}

/* ------------------------------------------------------------------ proxy */
function proxyApi(req, res) {
  const upstream = http.request(
    {
      host: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        detail:
          'Python API unreachable. Start it with: python -m uvicorn app:app --reload --port 8000',
      })
    );
  });
  req.pipe(upstream);
}

/* ------------------------------------------------------------------ pages */
const PAGE_ROUTES = {
  '/': {
    file: 'contacts.html',
    title: 'Contacts - Contact Book',
    page: 'contacts',
    script: 'contacts.js',
    modals: true,
    fab: true,
  },
  '/favorites': {
    file: 'favorites.html',
    title: 'Favorites - Contact Book',
    page: 'favorites',
    script: '',
    modals: false,
    fab: false,
  },
  '/groups': {
    file: 'groups.html',
    title: 'Groups - Contact Book',
    page: 'groups',
    script: '',
    modals: false,
    fab: false,
  },
  '/settings': {
    file: 'settings.html',
    title: 'Settings - Contact Book',
    page: 'settings',
    script: 'settings.js',
    modals: false,
    fab: false,
  },
  '/welcome': {
    file: 'welcome.html',
    title: 'Welcome - Contact Book',
    page: 'welcome',
    script: '',
    modals: false,
    fab: false,
    bare: true,
  },
  '/login': {
    file: 'login.html',
    title: 'Sign in - Contact Book',
    page: 'login',
    script: '',
    modals: false,
    fab: false,
    bare: true,
  },
  '/signup': {
    file: 'signup.html',
    title: 'Create account - Contact Book',
    page: 'signup',
    script: '',
    modals: false,
    fab: false,
    bare: true,
  },
};
PAGE_ROUTES['/index.html'] = PAGE_ROUTES['/'];

const FAB_SLOT = `<button id="fab-add" class="fab" type="button" aria-label="Add a new contact">
    <svg class="h-6 w-6 shrink-0" aria-hidden="true"><use href="#i-plus"></use></svg>
    <span class="fab-label">New contact</span>
  </button>`;

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
</head>
<body>
  <main>
    <h1>404 - page not found</h1>
    <p>That page is not part of the contact book.</p>
    <p><a href="/">Back to contacts</a></p>
  </main>
</body>
</html>`;

/* Templates are cached by path + mtimeMs so edits are picked up at once. */
const templateCache = new Map();

function readTemplate(file) {
  const stat = fs.statSync(file);
  const key = `${file}:${stat.mtimeMs}`;
  const cached = templateCache.get(key);
  if (cached !== undefined) return cached;

  const text = fs.readFileSync(file, 'utf8');
  templateCache.set(key, text);
  for (const existing of templateCache.keys()) {
    if (existing !== key && existing.startsWith(`${file}:`)) templateCache.delete(existing);
  }
  return text;
}

function renderPage(route) {
  const bare = Boolean(route.bare);
  const layout = readTemplate(path.join(PUBLIC_DIR, 'layout.html'));
  const header = readTemplate(path.join(PARTIALS_DIR, 'header.html'));
  const navBottom = readTemplate(path.join(PARTIALS_DIR, 'nav-bottom.html'));
  const content = readTemplate(path.join(PAGES_DIR, route.file));
  const modals = route.modals ? readTemplate(path.join(PARTIALS_DIR, 'modals.html')) : '';

  // auth.js loads on every page: it attaches the session JWT to /api calls
  const scripts = ['/js/auth.js'];
  if (route.script) scripts.push(`/js/${route.script}`);

  const values = {
    title: route.title || 'Contact Book',
    page: route.page,
    content,
    modals,
    fab: route.fab ? FAB_SLOT : '',
    page_script: scripts.map((src) => `<script src="${src}" defer></script>`).join('\n  '),
    head_extra: route.headExtra || '',
  };

  let html = layout.replace(/\{\{([a-z_]+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  );
  if (bare) {
    // welcome / login / signup: no app header, no bottom nav
    html = html.replace('<!-- include:header -->', '').replace('<!-- include:nav-bottom -->', '');
  } else {
    html = html.replace('<!-- include:header -->', () => header);
    html = html.replace('<!-- include:nav-bottom -->', () => navBottom);
  }

  return html
    .replace(/\{\{active:([a-z-]+)\}\}/g, (_m, name) => (name === route.page ? 'active' : ''))
    .replace(/\{\{current:([a-z-]+)\}\}/g, (_m, name) =>
      name === route.page ? 'aria-current="page"' : ''
    );
}

function servePage(route, res) {
  try {
    const html = renderPage(route);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (err) {
    console.error('[page]  render failed:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 - could not render page');
  }
}

function serveNotFound(res) {
  res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
  res.end(NOT_FOUND_HTML);
}

/* ------------------------------------------------------------------ static files */
function serveStatic(res, pathname) {
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(resolved, (err, stat) => {
    if (err || stat.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    fs.readFile(resolved, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
}

/* ------------------------------------------------------------------ http server */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }

  if (url.startsWith('/api/')) return proxyApi(req, res);

  let pathname;
  try {
    pathname = decodeURIComponent(url);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  const pagePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  const route = PAGE_ROUTES[pagePath];
  if (route) return servePage(route, res);

  if (!path.extname(pathname)) return serveNotFound(res);

  return serveStatic(res, pathname);
});

/* ------------------------------------------------------------------ process helpers */
function apiHealthy() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: API_HOST, port: API_PORT, path: '/api/health', method: 'GET', timeout: 1500 },
      (r) => {
        r.resume();
        resolve(r.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureApi() {
  if (await apiHealthy()) {
    console.log(`[api]   already running on :${API_PORT}`);
    return;
  }
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(
    python,
    ['-m', 'uvicorn', 'app:app', '--reload', '--port', String(API_PORT)],
    { cwd: BACKEND_DIR, stdio: 'inherit' }
  );
  CHILDREN.push(child);
  child.on('error', (err) => console.error('[api]   spawn failed:', err.message));

  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    if (await apiHealthy()) return console.log('[api]   ready on :8000');
  }
  console.error(
    '[api]   not healthy yet - check Python deps:  pip install -r backend/requirements.txt'
  );
}

function startTailwind() {
  // Node >= 18.20/20.12 on Windows refuses to spawn .cmd files directly
  // (CVE-2024-27980) -> EINVAL, so route through the shell on win32.
  // The CLI's --watch mode exits when stdin is not a TTY (background runs),
  // so instead we rebuild on demand and watch the source files ourselves.
  const binName = process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss';
  const bin = path.join(ROOT, 'node_modules', '.bin', binName);
  if (!fs.existsSync(bin)) {
    console.warn('[css]   Tailwind CLI missing -> run:  npm install');
    return;
  }
  const args = ['-i', './src/input.css', '-o', './public/css/styles.css', '--minify'];

  let building = false;
  let pending = false;

  const build = () => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    const started = Date.now();
    const child =
      process.platform === 'win32'
        ? spawn(bin, args, { cwd: ROOT, stdio: 'inherit', shell: true, windowsVerbatimArguments: false })
        : spawn(bin, args, { cwd: ROOT, stdio: 'inherit' });

    child.on('error', (err) => {
      building = false;
      console.error('[css]   build failed:', err.message);
    });
    child.on('exit', (code) => {
      building = false;
      if (code === 0) {
        console.log(`[css]   rebuilt in ${Date.now() - started}ms`);
        broadcast('styles.css');
      } else {
        console.error(`[css]   build exited with code ${code}`);
      }
      if (pending) {
        pending = false;
        build();
      }
    });
  };

  let cssTimer = null;
  const schedule = () => {
    clearTimeout(cssTimer);
    cssTimer = setTimeout(build, 140);
  };

  try {
    fs.watch(path.join(ROOT, 'src'), { recursive: true }, schedule);
    // Tailwind v4 scans public/ for class names, so markup edits need a rebuild
    // too - but never the build output itself, or we would loop forever.
    fs.watch(PUBLIC_DIR, { recursive: true }, (_event, file) => {
      if (!file) return;
      if (String(file).replace(/\\/g, '/').startsWith('css/')) return;
      schedule();
    });
    console.log('[css]   watching src/ + public/ for class changes');
  } catch (err) {
    console.warn('[css]   watcher unavailable:', err.message);
  }

  build();
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  console.log('\n  Personal Contact Book - dev server');
  console.log('  ----------------------------------');

  // Listen first so the UI is reachable immediately; the API is brought up
  // in the background instead of blocking the first page load.
  server.listen(PORT, () => {
    console.log(`[web]   http://localhost:${PORT}`);
    console.log(`[api]   http://localhost:${API_PORT}/api  (docs at /docs)\n`);
  });

  startTailwind();
  watchPublic();
  ensureApi();
}

function shutdown() {
  for (const child of CHILDREN) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Required as a module by scripts/build-static.js (the GitHub Pages export);
// started directly (node server.js / npm run dev) it boots the dev server.
module.exports = { renderPage, PAGE_ROUTES };

if (require.main === module) {
  boot();
}
