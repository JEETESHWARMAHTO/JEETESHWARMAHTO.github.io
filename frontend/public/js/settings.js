'use strict';

/* ============================================================
 * Settings page - storage health + Google sign-in (Supabase OAuth)
 * ============================================================ */

(function () {
  const CB = window.CB;
  const { api, esc, icon, initials, toast, setApiStatus } = CB;

  const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  let client = null;
  let session = null;

  const $ = (sel) => document.querySelector(sel);

  /* ------------------------------------------------------------------ storage */
  async function loadHealth() {
    const storage = $('#storage-value');
    try {
      const health = await api('/health');
      setApiStatus(true);
      if (!storage) return;
      const label = health.storage || 'unknown storage';
      const count = Number.isFinite(health.contacts) ? health.contacts : null;
      storage.textContent =
        count === null ? label : `${label} - ${count} contact${count === 1 ? '' : 's'}`;
    } catch (err) {
      setApiStatus(false, err.message);
      if (storage) storage.textContent = 'Unavailable';
    }
  }

  /* ------------------------------------------------------------------ google */
  function paintButton() {
    const btn = $('#google-signin');
    if (!btn) return;
    btn.innerHTML = session
      ? `${icon('x', 'h-[18px] w-[18px]')} Sign out`
      : `${icon('google', 'h-[18px] w-[18px]')} Sign in with Google`;
  }

  function paintSession() {
    const stateRow = $('#google-account-state');
    const badge = $('#google-badge');

    if (session && session.user) {
      const email = session.user.email || 'Google account';
      const meta = session.user.user_metadata || {};
      const avatarUrl = meta.avatar_url || meta.picture || '';
      const avatar = avatarUrl
        ? `<img src="${esc(avatarUrl)}" alt="" class="h-8 w-8 shrink-0 rounded-full object-cover" />`
        : `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style="background:${CB.avatarColor(email)}">${esc(initials(email))}</span>`;

      if (stateRow) {
        stateRow.innerHTML = `${avatar}<span class="min-w-0 flex-1 truncate">${esc(email)}</span>`;
        stateRow.classList.remove('hidden');
        stateRow.classList.add('flex');
      }
      if (badge) badge.classList.add('hidden');
    } else {
      if (stateRow) {
        stateRow.innerHTML = '';
        stateRow.classList.add('hidden');
        stateRow.classList.remove('flex');
      }
      if (badge) badge.classList.remove('hidden');
    }

    paintButton();
  }

  async function loadClient() {
    if (client) return client;

    let config;
    try {
      config = await api('/config');
    } catch {
      throw new Error('Sign-in service unreachable');
    }
    if (!config || config.authEnabled !== true || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Google provider not configured yet');
    }

    let mod;
    try {
      mod = await import(SUPABASE_ESM);
    } catch {
      throw new Error('Sign-in service unreachable');
    }
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (!createClient) throw new Error('Sign-in service unreachable');

    client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    client.auth.onAuthStateChange((_event, next) => {
      session = next;
      paintSession();
    });
    return client;
  }

  async function signIn() {
    const btn = $('#google-signin');
    btn.disabled = true;
    try {
      const supabase = await loadClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + '/settings' },
      });
      if (error) throw new Error(error.message || 'Sign-in service unreachable');
    } catch (err) {
      toast(err.message || 'Sign-in service unreachable', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  async function signOut() {
    const btn = $('#google-signin');
    btn.disabled = true;
    try {
      if (client) {
        const { error } = await client.auth.signOut();
        if (error) throw new Error(error.message || 'Sign-out failed');
      }
      session = null;
      paintSession();
      toast('Signed out');
    } catch (err) {
      toast(err.message || 'Sign-out failed', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ boot */
  document.addEventListener('DOMContentLoaded', () => {
    paintButton();
    loadHealth();

    const btn = $('#google-signin');
    if (btn) btn.addEventListener('click', () => (session ? signOut() : signIn()));

    (async () => {
      try {
        const supabase = await loadClient();
        const { data } = await supabase.auth.getSession();
        session = (data && data.session) || null;
        paintSession();
      } catch {
        /* stays signed out; the button explains why when clicked */
      }
    })();
  });
})();
