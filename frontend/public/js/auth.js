'use strict';

/* ============================================================
 * Auth: email/password sessions for the Contact Book
 * ------------------------------------------------------------
 * - Persists the session (cb-session in localStorage)
 * - Patches fetch() so every /api/* call carries the JWT
 * - Auto-refreshes an expired token once, then retries
 * - Renders the header account slot, binds the auth forms
 * - Sends first-time visitors to /welcome
 * Loaded by server.js on every page, before the page script.
 * ============================================================ */

(function () {
  const CB = (window.CB = window.CB || {});
  const KEY = 'cb-session';
  const WELCOME_FLAG = 'cb-seen-welcome';
  const SKIP_REFRESH = [
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/refresh',
    '/api/auth/logout',
  ];

  /* Static hosting has no Python proxy: serve /api/* straight from Supabase.
   * Injected by scripts/build-static.js as window.__CB_HOSTED__. */
  const HOSTED = window.__CB_HOSTED__ || null;
  const SB = HOSTED ? String(HOSTED.supabaseUrl).replace(/\/+$/, '') : '';
  const ANON = HOSTED ? HOSTED.supabaseAnonKey : '';
  const REST = SB + '/rest/v1';
  const GOTRUE = SB + '/auth/v1';
  const SEARCH_COLS = ['name', 'phone', 'email', 'company', 'address', 'notes'];

  function jsonRes(status, body) {
    return new Response(body === null || body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function authCall(method, path, body, bearer) {
    const headers = { apikey: ANON, 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const res = await origFetch(GOTRUE + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { status: res.status, data, ok: res.ok };
  }

  function authErr(status, data, fallback) {
    const msg = String((data && (data.msg || data.error_description)) || '').toLowerCase();
    const code = String((data && (data.error_code || data.code)) || '');
    if (code === 'user_already_exists' || msg.includes('already registered'))
      return jsonRes(409, { detail: 'An account with that email already exists' });
    if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
      return jsonRes(401, { detail: 'Email or password is incorrect' });
    if (code === 'weak_password' || msg.includes('password should be at least'))
      return jsonRes(400, { detail: 'Password must be at least 8 characters' });
    if (status >= 500) return jsonRes(502, { detail: 'Authentication service error, try again' });
    return jsonRes(400, { detail: fallback });
  }

  function sessionFields(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_in: d.expires_in,
      user: d.user,
    };
  }

  async function restCall(method, path, body, extra) {
    const headers = {
      apikey: ANON,
      Authorization: 'Bearer ' + (session ? session.access_token : ANON),
      'Content-Type': 'application/json',
      ...(extra || {}),
    };
    const res = await origFetch(REST + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { status: res.status, data, ok: res.ok, headers: res.headers };
  }

  function restErr(r) {
    let detail = 'Request failed';
    if (r.data && typeof r.data === 'object')
      detail = r.data.message || r.data.hint || r.data.details || detail;
    else if (typeof r.data === 'string' && r.data) detail = r.data;
    if (r.status === 401) detail = 'Sign in again to continue';
    return jsonRes(r.status, { detail });
  }

  async function hostedApi(url, opts) {
    const u = new URL(url, location.origin);
    const path = u.pathname;
    const method = (opts.method || 'GET').toUpperCase();
    let body;
    try { body = opts.body ? JSON.parse(opts.body) : undefined; } catch (_) { body = opts.body; }

    if (path.startsWith('/api/auth/')) {
      const name = path.slice('/api/auth/'.length);
      if (name === 'signup') {
        const r = await authCall('POST', '/signup', { email: body.email, password: body.password });
        if (!r.ok) return authErr(r.status, r.data, 'Could not create the account');
        if (r.data && r.data.access_token)
          return jsonRes(200, { user: r.data.user, session: sessionFields(r.data) });
        return jsonRes(200, { user: r.data, session: null });
      }
      if (name === 'login') {
        const r = await authCall('POST', '/token?grant_type=password', { email: body.email, password: body.password });
        if (!r.ok) return authErr(r.status, r.data, 'Could not sign in');
        return jsonRes(200, sessionFields(r.data));
      }
      if (name === 'refresh') {
        const r = await authCall('POST', '/token?grant_type=refresh_token', { refresh_token: body.refresh_token });
        if (!r.ok) return jsonRes(401, { detail: 'Session expired, sign in again' });
        return jsonRes(200, sessionFields(r.data));
      }
      if (name === 'logout') return jsonRes(200, { ok: true });
      if (name === 'user') {
        const r = await authCall('GET', '/user', undefined, session && session.access_token);
        if (!r.ok || !r.data || !r.data.id) return jsonRes(401, { detail: 'Sign in again to continue' });
        return jsonRes(200, { id: r.data.id, email: r.data.email, created_at: r.data.created_at });
      }
      return jsonRes(404, { detail: 'Not found' });
    }

    if (path === '/api/health') {
      const r = await restCall('GET', '/contacts?select=id&limit=1', undefined, { Prefer: 'count=exact' });
      if (!r.ok) return restErr(r);
      const cr = String(r.headers.get('content-range') || '');
      const total = parseInt(cr.split('/').pop(), 10) || 0;
      return jsonRes(200, { status: 'ok', service: 'contact-book-api', storage: 'supabase (postgres)', contacts: total });
    }
    if (path === '/api/config') {
      return jsonRes(200, {
        supabaseUrl: SB, supabaseAnonKey: ANON, authEnabled: true,
        provider: 'google', storage: 'supabase (postgres)',
      });
    }
    if (path === '/api/contacts/favorites') {
      const r = await restCall('GET', '/contacts?select=*&favorite=eq.true&order=name.asc');
      return r.ok ? jsonRes(200, r.data || []) : restErr(r);
    }
    if (path === '/api/contacts/groups') {
      const r = await restCall('GET', '/contacts?select=group');
      if (!r.ok) return restErr(r);
      const counts = {};
      (r.data || []).forEach((row) => {
        const g = row.group || '';
        counts[g] = (counts[g] || 0) + 1;
      });
      const list = Object.keys(counts)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map((g) => ({ group: g === '' ? 'Ungrouped' : g, count: counts[g] }));
      return jsonRes(200, list);
    }
    if (path === '/api/contacts') {
      if (method === 'POST') {
        const payload = { ...(body || {}) };
        if (session && session.user && session.user.id) payload.user_id = session.user.id;
        const r = await restCall('POST', '/contacts?select=*', payload, { Prefer: 'return=representation' });
        if (!r.ok) return restErr(r);
        return jsonRes(201, Array.isArray(r.data) ? r.data[0] : r.data);
      }
      const params = ['select=*'];
      const q = (u.searchParams.get('q') || '').trim();
      if (q) {
        const like = encodeURIComponent('*' + q + '*');
        params.push('or=(' + SEARCH_COLS.map((c) => `${c}.ilike.${like}`).join(',') + ')');
      }
      const fav = u.searchParams.get('favorite');
      if (fav === 'true' || fav === 'false') params.push('favorite=eq.' + fav);
      const group = u.searchParams.get('group');
      if (group !== null) params.push('group=eq.' + encodeURIComponent(group === 'Ungrouped' ? '' : group));
      params.push('order=name.asc');
      const r = await restCall('GET', '/contacts?' + params.join('&'));
      return r.ok ? jsonRes(200, r.data || []) : restErr(r);
    }
    const one = path.match(/^\/api\/contacts\/(\d+)$/);
    if (one) {
      const id = one[1];
      if (method === 'GET') {
        const r = await restCall('GET', `/contacts?select=*&id=eq.${id}`);
        if (!r.ok) return restErr(r);
        if (!Array.isArray(r.data) || !r.data.length) return jsonRes(404, { detail: 'Contact not found' });
        return jsonRes(200, r.data[0]);
      }
      if (method === 'PUT') {
        const payload = { ...(body || {}), updated_at: new Date().toISOString() };
        const r = await restCall('PATCH', `/contacts?id=eq.${id}&select=*`, payload, { Prefer: 'return=representation' });
        if (!r.ok) return restErr(r);
        if (!Array.isArray(r.data) || !r.data.length) return jsonRes(404, { detail: 'Contact not found' });
        return jsonRes(200, r.data[0]);
      }
      if (method === 'DELETE') {
        const r = await restCall('DELETE', `/contacts?id=eq.${id}&select=id`, undefined, { Prefer: 'return=representation' });
        if (!r.ok) return restErr(r);
        if (!Array.isArray(r.data) || !r.data.length) return jsonRes(404, { detail: 'Contact not found' });
        return jsonRes(204, null);
      }
    }
    return jsonRes(404, { detail: 'Not found' });
  }

  /* ------------------------------------------------------------ session */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const s = raw ? JSON.parse(raw) : null;
      return s && s.access_token ? s : null;
    } catch (_) {
      return null;
    }
  }

  let session = load();

  function save(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user || null,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch (_) {
      /* storage disabled - session stays in memory only */
    }
  }

  function clear() {
    session = null;
    try {
      localStorage.removeItem(KEY);
    } catch (_) {}
  }

  async function refresh() {
    if (!session || !session.refresh_token) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) return false;
      save(await res.json());
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------ fetch patch */
  const origFetch = window.fetch.bind(window);

  function withAuth(opts, token) {
    const headers = new Headers(opts.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return { ...opts, headers };
  }

  window.fetch = async function patchedFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isApi = url.startsWith('/api/');
    const skip = SKIP_REFRESH.some((p) => url.startsWith(p));
    let opts = init || {};

    if (isApi && !skip && session && !HOSTED) opts = withAuth(opts, session.access_token);

    const send = () => (HOSTED && isApi ? hostedApi(url, opts) : origFetch(input, opts));

    let res = await send();

    if (res.status === 401 && isApi && !skip && session) {
      const body = await res.clone().json().catch(() => null);
      const detail = body && typeof body.detail === 'string' ? body.detail : '';
      if (/sign in again|expired/i.test(detail)) {
        if (await refresh()) {
          opts = withAuth(opts, session.access_token);
          res = await send();
        } else {
          clear();
          render();
          const p = location.pathname;
          if (p !== '/login' && p !== '/signup' && p !== '/welcome') location.href = '/login';
        }
      }
    }
    return res;
  };

  /* ------------------------------------------------------------ auth API */
  async function post(path, payload) {
    const res = await fetch('/api/auth' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body && body.detail;
      throw new Error(typeof detail === 'string' && detail ? detail : `Request failed (${res.status})`);
    }
    return body;
  }

  const auth = {
    get session() {
      return session;
    },
    get user() {
      return (session && session.user) || null;
    },
    get signedIn() {
      return Boolean(session);
    },

    async signUp(email, password) {
      const data = await post('/signup', { email, password });
      if (data && data.session && data.session.access_token) save(data.session);
      else if (data && data.access_token) save(data);
      return data && data.user;
    },

    async signIn(email, password) {
      const data = await post('/login', { email, password });
      save(data);
      return data.user;
    },

    async signOut() {
      try {
        await post('/logout', {});
      } catch (_) {
        /* session is gone either way */
      }
      clear();
      render();
    },
  };
  CB.auth = auth;

  /* ------------------------------------------------------------ header slot */
  function setVisible(el, show) {
    el.classList.toggle('hidden', !show);
    el.classList.toggle('flex', show);
  }

  function render() {
    const slot = document.getElementById('auth-slot');
    if (slot) {
      if (auth.signedIn) {
        const email = (auth.user && auth.user.email) || '';
        const initial = (email[0] || '?').toUpperCase();
        const color = CB.avatarColor ? CB.avatarColor(email) : '#1a73e8';
        slot.innerHTML =
          `<a href="/settings" class="btn gap-2" title="${CB.esc(email)}">` +
          `<span class="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white" style="background:${color}">${CB.esc(initial)}</span>` +
          `<span class="hidden sm:inline">${CB.esc(email)}</span>` +
          `</a>`;
      } else {
        slot.innerHTML = `<a href="/login" class="btn">Sign in</a>`;
      }
    }
    document.querySelectorAll('[data-auth="in"]').forEach((el) => setVisible(el, auth.signedIn));
    document.querySelectorAll('[data-auth="out"]').forEach((el) => setVisible(el, !auth.signedIn));

    // settings page account card (slot rendered by the Settings page)
    const account = document.getElementById('account-slot');
    if (account) {
      if (auth.signedIn) {
        const email = (auth.user && auth.user.email) || '';
        const initial = (email[0] || '?').toUpperCase();
        const color = CB.avatarColor ? CB.avatarColor(email) : '#1a73e8';
        account.innerHTML =
          '<div class="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3.5">' +
          '<div class="flex items-center gap-3">' +
          `<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style="background:${color}">${CB.esc(initial)}</span>` +
          '<div class="min-w-0 flex-1">' +
          `<p class="truncate text-sm font-semibold">${CB.esc(email)}</p>` +
          '<p class="text-[12px] leading-relaxed text-ink-dim">Signed in - contacts you add are private to this account</p>' +
          '</div></div>' +
          '<button class="btn mt-3 w-full justify-center" type="button" data-signout>Sign out</button>' +
          '</div>';
      } else {
        account.innerHTML =
          '<div class="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3.5">' +
          '<p class="text-sm font-semibold">Browsing as a guest</p>' +
          '<p class="mt-1 text-[12px] leading-relaxed text-ink-dim">Create an account and your contacts stay private to you.</p>' +
          '<div class="mt-3 flex gap-2">' +
          '<a href="/signup" class="btn btn-primary flex-1 justify-center">Create account</a>' +
          '<a href="/login" class="btn flex-1 justify-center">Sign in</a>' +
          '</div></div>';
      }
    }
  }

  /* ------------------------------------------------------------ auth forms */
  function bindForm() {
    const form = document.getElementById('auth-form');
    if (!form) return;
    const mode = form.dataset.mode === 'signup' ? 'signup' : 'login';
    const errorEl = document.getElementById('auth-error');
    const submit = document.getElementById('auth-submit');
    const defaultLabel = submit ? submit.textContent.trim() : '';

    const fail = (msg) => {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
      }
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (errorEl) errorEl.classList.add('hidden');

      const email = (form.elements.email.value || '').trim();
      const password = form.elements.password.value || '';
      const confirm = form.elements.confirm ? form.elements.confirm.value : null;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address');
      if (password.length < 8) return fail('Password must be at least 8 characters');
      if (confirm !== null && confirm !== password) return fail('Passwords do not match');

      if (submit) {
        submit.disabled = true;
        submit.textContent = mode === 'signup' ? 'Creating account...' : 'Signing in...';
      }

      try {
        if (mode === 'signup') {
          await auth.signUp(email, password);
          if (!auth.signedIn) await auth.signIn(email, password);
        } else {
          await auth.signIn(email, password);
        }
        location.href = '/';
      } catch (err) {
        fail(err && err.message ? err.message : 'Something went wrong - try again');
        if (submit) {
          submit.disabled = false;
          submit.textContent = defaultLabel;
        }
      }
      return undefined;
    });
  }

  /* ------------------------------------------------------------ boot */
  async function boot() {
    const path = location.pathname;

    // first-ever visit to the app goes through the welcome page
    let seenWelcome = false;
    try {
      seenWelcome = Boolean(localStorage.getItem(WELCOME_FLAG));
    } catch (_) {
      seenWelcome = true;
    }
    if (path === '/' && !seenWelcome && !auth.signedIn) {
      try {
        localStorage.setItem(WELCOME_FLAG, '1');
      } catch (_) {}
      location.replace('/welcome');
      return;
    }

    // refresh an expired session before the first API call
    if (session && session.expires_at && Date.now() >= session.expires_at - 30000) {
      if (!(await refresh())) clear();
    }

    render();
    bindForm();

    // signed-in visitors do not need the auth forms
    if (auth.signedIn && (path === '/login' || path === '/signup')) {
      location.replace('/');
      return;
    }

    document.querySelectorAll('[data-signout]').forEach((el) => {
      el.addEventListener('click', async (event) => {
        event.preventDefault();
        await auth.signOut();
        location.href = '/welcome';
      });
    });
  }

  boot();
})();
