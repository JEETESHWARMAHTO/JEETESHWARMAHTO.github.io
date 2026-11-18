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

  /* ------------------------------------------------------------------ entries
   * One renderer for contact entries, shared by the Contacts and Favorites
   * lists so the markup (and its data-action contract) can never drift apart.
   * opts: { star, menu, footer } - each defaults to true. */
  const { esc, icon, initials, avatarColor, fmtDate } = CB;

  const MORE_ICON =
    '<svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

  const fieldRow = (ic, value) =>
    value
      ? `<div class="flex items-start gap-2">
           <span class="mt-0.5 shrink-0 text-ink-dim">${icon(ic, 'h-3.5 w-3.5')}</span>
           <span class="min-w-0 flex-1 truncate text-[13px] text-ink/85" title="${esc(value)}">${esc(value)}</span>
         </div>`
      : '';

  CB.entryHTML = function entryHTML(c, i, opts = {}) {
    const delay = Math.min(i * 40, 320);
    const sub = c.company || c.phone || c.email || '';
    const hasDetails = c.phone || c.email || c.address;
    const avatar = c.avatar
      ? `<img src="${esc(c.avatar)}" alt="" class="entry-avatar" />`
      : `<span class="entry-avatar" style="background:${avatarColor(c.id)}">${esc(initials(c.name))}</span>`;
    const starred = Boolean(c.favorite);
    const starLabel = starred
      ? `Remove ${c.name} from favorites`
      : `Add ${c.name} to favorites`;

    const rowStar =
      opts.star === false
        ? ''
        : `<button type="button" class="entry-star" data-action="star" aria-pressed="${starred}" aria-label="${esc(starLabel)}">${icon('star', 'h-4 w-4')}</button>`;

    const menuBtn =
      opts.menu === false
        ? ''
        : `<button type="button" class="entry-more" data-action="menu" aria-label="Actions for ${esc(c.name)}" aria-expanded="false">${MORE_ICON}</button>`;

    const footerStar =
      opts.star === false
        ? ''
        : `<button type="button" class="btn px-2.5" data-action="star" aria-pressed="${starred}" aria-label="${esc(starLabel)}">${icon('star', 'h-4 w-4')}</button>`;

    const footerActions =
      opts.footer === false
        ? ''
        : `<button class="btn flex-1 px-3 text-[13px]" data-action="edit">${icon('pencil', 'h-3.5 w-3.5')} Edit</button>
           <button class="btn btn-danger flex-1 px-3 text-[13px]" data-action="delete">${icon('trash', 'h-3.5 w-3.5')} Delete</button>`;

    const footer =
      footerStar || footerActions ? `<div class="entry-footer">${footerStar}${footerActions}</div>` : '';

    const entryMenu =
      opts.menu === false
        ? ''
        : `<div class="entry-menu" hidden>
             <button type="button" class="entry-menu-btn" data-action="edit">${icon('pencil', 'h-4 w-4')} Edit</button>
             <button type="button" class="entry-menu-btn danger" data-action="delete">${icon('trash', 'h-4 w-4')} Delete</button>
           </div>`;

    return `
      <article class="entry tilt-card" data-id="${c.id}" style="animation-delay:${delay}ms">
        <button type="button" class="entry-open" data-action="view" aria-label="View ${esc(c.name)}">
          ${avatar}
          <span class="entry-text">
            <span class="entry-name">${esc(c.name)}</span>
            <span class="entry-sub">${esc(sub || 'No details yet')}</span>
          </span>
        </button>
        ${rowStar}
        ${menuBtn}
        <div class="entry-details">
          ${fieldRow('phone', c.phone)}
          ${fieldRow('mail', c.email)}
          ${fieldRow('pin', c.address)}
          ${hasDetails ? '' : '<p class="entry-empty">No details yet - edit to fill this in.</p>'}
        </div>
        ${footer}
        ${entryMenu}
      </article>`;
  };

  /* Delegated click handling for a rendered entry list.
   * handlers: { find(id), view(c), star(c), edit(c), delete(c) } */
  CB.bindEntries = function bindEntries(grid, handlers = {}) {
    const closeMenus = (except) => {
      [...grid.querySelectorAll('.entry-menu')].forEach((menu) => {
        const card = menu.closest('[data-id]');
        if (card === except) return;
        menu.setAttribute('hidden', '');
        const more = card && card.querySelector('[data-action="menu"]');
        if (more) more.setAttribute('aria-expanded', 'false');
      });
    };

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('[data-id]');
      const id = card ? Number(card.dataset.id) : NaN;
      const action = btn.dataset.action;

      if (action === 'menu') {
        /* touch has no hover, so edit/delete live behind this toggle */
        const menu = card && card.querySelector('.entry-menu');
        if (!menu) return;
        const willOpen = menu.hasAttribute('hidden');
        closeMenus();
        if (willOpen) {
          menu.removeAttribute('hidden');
          btn.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      closeMenus();
      const contact = handlers.find ? handlers.find(id) : null;
      if (!contact) return;
      const handler = handlers[action];
      if (handler) handler(contact, btn);
    });

    /* tapping outside an entry collapses its action row */
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-id]')) closeMenus();
    });
  };

  /* ------------------------------------------------------------------ detail popup */
  const detailRow = (ic, label, value, href) => {
    if (!value) return '';
    const body = href
      ? `<a class="break-words text-sm text-brand-2 hover:underline" href="${href}">${esc(value)}</a>`
      : `<span class="break-words text-sm text-ink">${esc(value)}</span>`;
    return `
      <div class="flex items-start gap-2.5 rounded-xl border border-line bg-white/70 px-3 py-2.5">
        <span class="mt-0.5 text-ink-dim">${icon(ic, 'h-4 w-4')}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium text-ink-dim">${label}</p>
          <div class="mt-0.5">${body}</div>
        </div>
      </div>`;
  };

  /* Paint #detail-* from a contact; the current record is kept on CB.detail. */
  CB.paintDetail = function paintDetail(c) {
    const avatarEl = document.getElementById('detail-avatar');
    const nameEl = document.getElementById('detail-name');
    const companyEl = document.getElementById('detail-company');
    const bodyEl = document.getElementById('detail-body');
    if (!avatarEl || !nameEl || !companyEl || !bodyEl) return;

    if (c.avatar) {
      avatarEl.className = 'h-16 w-16 shrink-0 overflow-hidden rounded-full';
      avatarEl.style.background = '';
      avatarEl.innerHTML = `<img src="${esc(c.avatar)}" alt="" class="h-full w-full object-cover" />`;
    } else {
      avatarEl.className =
        'grid h-16 w-16 shrink-0 place-items-center rounded-full text-xl font-bold text-white';
      avatarEl.style.background = avatarColor(c.id);
      avatarEl.textContent = initials(c.name);
    }

    nameEl.textContent = c.name;
    companyEl.textContent = c.company || 'No company listed';

    const edited = c.updated_at && c.updated_at !== c.created_at;
    bodyEl.innerHTML = [
      detailRow('phone', 'Phone', c.phone, c.phone ? `tel:${c.phone.replace(/\s+/g, '')}` : ''),
      detailRow('mail', 'Email', c.email, c.email ? `mailto:${c.email}` : ''),
      detailRow('building', 'Company', c.company),
      detailRow('pin', 'Address', c.address),
      detailRow('note', 'Notes', c.notes),
      `<p class="px-1 pt-1 text-xs text-ink-dim">Added ${fmtDate(c.created_at)}${edited ? ` &middot; Edited ${fmtDate(c.updated_at)}` : ''}</p>`,
    ].join('');

    CB.detail = c;
  };

  CB.openDetail = function openDetail(c) {
    CB.paintDetail(c);
    CB.openModal(document.getElementById('detail-modal'));
  };

  /* ------------------------------------------------------------------ confirm dialog
   * One shared promise per page; #confirm-yes / #confirm-no resolve it. */
  let confirmResolve = null;

  CB.confirm = function confirm(message) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      const msg = document.getElementById('confirm-message');
      if (msg) msg.textContent = message;
      CB.openModal(document.getElementById('confirm-modal'));
    });
  };

  CB.confirmClose = function confirmClose(result) {
    CB.closeModal(document.getElementById('confirm-modal'));
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
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
        ? 'border-amber-400/50 text-amber-900'
        : 'border-emerald-400/50 text-emerald-900';
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

  // PWA: register the service worker (secure contexts / localhost only)
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' ||
       ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failure must never break the app */
      });
    });
  }
})();
