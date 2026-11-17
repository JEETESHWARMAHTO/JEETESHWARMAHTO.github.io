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

    if (isApi && !skip && session) opts = withAuth(opts, session.access_token);

    let res = await origFetch(input, opts);

    if (res.status === 401 && isApi && !skip && session) {
      const body = await res.clone().json().catch(() => null);
      const detail = body && typeof body.detail === 'string' ? body.detail : '';
      if (/sign in again|expired/i.test(detail)) {
        if (await refresh()) {
          opts = withAuth(opts, session.access_token);
          res = await origFetch(input, opts);
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
    const res = await origFetch('/api/auth' + path, {
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
