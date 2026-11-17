'use strict';

/* ============================================================
 * Shared shell helpers
 * ------------------------------------------------------------
 * Loaded before every page script so window.CB is always ready.
 * Handles the header search, live reload and small UI utilities.
 * ============================================================ */

(function () {
  const API = '/api';
  const CB = (window.CB = window.CB || {});
  const $ = (sel, root = document) => root.querySelector(sel);

  CB.formDirty = false;

  /* ------------------------------------------------------------------ helpers */
  CB.esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  CB.icon = (name, cls = 'h-4 w-4') =>
    `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  CB.initials = (name = '') =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => (w[0] || '').toUpperCase())
      .join('') || '?';

  /* Google Contacts avatar palette - solid circles keyed by id (or hashed text) */
  CB.avatarColors = [
    '#1a73e8', '#0b8043', '#d50000', '#f4511e', '#039be5',
    '#616161', '#8e24aa', '#c5221f', '#e37400', '#188038',
  ];

  CB.avatarColor = function avatarColor(key) {
    const palette = CB.avatarColors;
    const n = Number(key);
    if (Number.isFinite(n) && String(key).trim() !== '') {
      return palette[Math.abs(Math.trunc(n)) % palette.length];
    }
    const s = String(key ?? '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  };

  CB.fmtDate = function fmtDate(s) {
    if (!s) return '';
    const iso = s.includes('Z') || s.includes('+') || s.includes('-', 10) ? s : `${s.replace(' ', 'T')}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? s
      : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  /* Resize + compress a picked image to a small square-ish data URL. */
  CB.fileToDataUrl = function fileToDataUrl(file, maxSize = 320) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not read that image'));
      };
      img.src = objectUrl;
    });
  };

  /* ------------------------------------------------------------------ API */
  CB.api = async function api(path, options = {}) {
    const res = await fetch(API + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body && body.detail;
      const msg = Array.isArray(detail) ? detail.map((d) => d.msg).join(', ') : detail;
      throw new Error(msg || `Request failed (${res.status})`);
    }
    return body;
  };

  /* ------------------------------------------------------------------ modals */
  let lastFocused = null;

  CB.openModal = function openModal(el) {
    if (!el) return;
    lastFocused = document.activeElement;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const first = el.querySelector('input, textarea, button');
      if (first) first.focus();
    }, 80);
  };

  CB.closeModal = function closeModal(el) {
    if (!el) return;
    el.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
    if (el.id === 'form-modal') CB.formDirty = false;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  };

  /* ------------------------------------------------------------------ toasts */
  CB.toast = function toast(message, kind = 'ok') {
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    const tone =
      kind === 'warn'
        ? 'border-amber-300/40 text-amber-100'
        : 'border-emerald-300/40 text-emerald-100';
    el.className = `toast glass-strong flex w-full items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm sm:w-auto ${tone}`;
    el.innerHTML = `${CB.icon(kind === 'warn' ? 'alert' : 'check', 'h-4 w-4 shrink-0')}<span>${CB.esc(message)}</span>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 320);
    }, 3000);
  };

  /* ------------------------------------------------------------------ api banner */
  CB.setApiStatus = function setApiStatus(ok, message) {
    const banner = $('#api-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', ok);
    banner.classList.toggle('flex', !ok);
    const text = $('#api-banner-text');
    if (!ok && message && text) text.textContent = message;
  };

  /* ------------------------------------------------------------------ live reload */
  CB.connectLiveReload = function connectLiveReload() {
    if (!('EventSource' in window)) return;
    const es = new EventSource('/__livereload');
    es.onmessage = (e) => {
      if (e.data.startsWith('css:')) {
        const link =
          document.querySelector('link[href*="/css/styles.css"]') ||
          document.querySelector('link[rel="stylesheet"]');
        if (link) link.href = `/css/styles.css?v=${Date.now()}`;
        return;
      }
      if (CB.formDirty) {
        CB.toast('Files changed - finish editing, then reload', 'warn');
        return;
      }
      location.reload();
    };
  };

  /* ------------------------------------------------------------------ search */
  function bindSearch() {
    const shell = $('#search-shell');
    if (!shell) return;
    const input = $('#search-input');
    const toggle = $('#search-toggle');
    const clear = $('#search-clear');
    const onContacts = document.body.dataset.page === 'contacts';
    let timer = null;

    const setHasValue = () => shell.classList.toggle('has-value', Boolean(input.value));

    const closeSearch = (clearQuery) => {
      shell.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      if (clearQuery && input.value) {
        input.value = '';
        setHasValue();
        if (onContacts && CB.onSearchChange) CB.onSearchChange('');
      }
    };

    const applyQuery = () => {
      clearTimeout(timer);
      if (onContacts && CB.onSearchChange) CB.onSearchChange(input.value);
    };

    const goToContacts = () => {
      const q = input.value.trim();
      if (!q) return;
      location.href = `/?q=${encodeURIComponent(q)}`;
    };

    toggle.addEventListener('click', () => {
      if (shell.classList.contains('open')) {
        if (!onContacts && input.value.trim()) {
          goToContacts();
          return;
        }
        closeSearch(true);
        return;
      }
      shell.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      setTimeout(() => input.focus(), 140);
    });

    input.addEventListener('input', () => {
      setHasValue();
      if (!onContacts) return;
      clearTimeout(timer);
      timer = setTimeout(applyQuery, 280);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSearch(true);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (onContacts) applyQuery();
        else goToContacts();
      }
    });

    clear.addEventListener('click', () => {
      input.value = '';
      setHasValue();
      applyQuery();
      input.focus();
    });
  }

  bindSearch();
  CB.connectLiveReload();
})();
