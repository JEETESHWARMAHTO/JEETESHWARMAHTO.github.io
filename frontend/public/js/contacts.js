'use strict';

/* ============================================================
 * Contacts page - list, stats, create / edit / delete popups
 * ============================================================ */

(function () {
  const CB = window.CB;
  const { esc, icon, initials, fmtDate, api, toast, fileToDataUrl, openModal, closeModal } = CB;

  const FIELDS = ['name', 'phone', 'email', 'company', 'address', 'notes'];
  const { avatarColor } = CB;

  /* three-dot affordance (no sprite symbol for it in layout.html) */
  const MORE_ICON =
    '<svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

  const state = {
    contacts: [],
    query: '',
    selected: null,
    formMode: 'create',
    editingId: null,
    formAvatar: '',
  };

  let cachedStats = { total: 0, email: 0, recent: 0 };
  let confirmResolve = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ------------------------------------------------------------------ data */
  async function loadContacts() {
    setLoading(true);
    try {
      const q = state.query.trim();
      state.contacts = await api(`/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      render();
      CB.setApiStatus(true);
    } catch (err) {
      CB.setApiStatus(false, err.message);
      renderError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function checkHealth() {
    try {
      await api('/health');
      CB.setApiStatus(true);
    } catch (err) {
      CB.setApiStatus(false, err.message);
    }
  }

  /* ------------------------------------------------------------------ stats */
  function paintStats({ total, email, recent }) {
    $('#stat-total').textContent = total;
    $('#stat-email').textContent = email;
    $('#stat-recent').textContent = recent;
  }

  function updateStats() {
    if (state.query.trim()) {
      paintStats(cachedStats); // keep last unfiltered numbers while searching
      return;
    }
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const list = state.contacts;
    cachedStats = {
      total: list.length,
      email: list.filter((c) => c.email).length,
      recent: list.filter((c) => {
        const t = Date.parse(c.created_at || '');
        return !Number.isNaN(t) && t >= weekAgo;
      }).length,
    };
    paintStats(cachedStats);
  }

  /* ------------------------------------------------------------------ render */
  const fieldRow = (ic, value) =>
    value
      ? `<div class="flex items-start gap-2">
           <span class="mt-0.5 shrink-0 text-ink-dim">${icon(ic, 'h-3.5 w-3.5')}</span>
           <span class="min-w-0 flex-1 truncate text-[13px] text-ink/85" title="${esc(value)}">${esc(value)}</span>
         </div>`
      : '';

  function entryHTML(c, i) {
    const delay = Math.min(i * 40, 320);
    const sub = c.company || c.phone || c.email || '';
    const hasDetails = c.phone || c.email || c.address;
    const avatar = c.avatar
      ? `<img src="${esc(c.avatar)}" alt="" class="entry-avatar" />`
      : `<span class="entry-avatar" style="background:${avatarColor(c.id)}">${esc(initials(c.name))}</span>`;

    return `
      <article class="entry tilt-card" data-id="${c.id}" style="animation-delay:${delay}ms">
        <button type="button" class="entry-open" data-action="view" aria-label="View ${esc(c.name)}">
          ${avatar}
          <span class="entry-text">
            <span class="entry-name">${esc(c.name)}</span>
            <span class="entry-sub">${esc(sub || 'No details yet')}</span>
          </span>
        </button>
        <button type="button" class="entry-more" data-action="menu" aria-label="Actions for ${esc(c.name)}" aria-expanded="false">${MORE_ICON}</button>
        <div class="entry-details">
          ${fieldRow('phone', c.phone)}
          ${fieldRow('mail', c.email)}
          ${fieldRow('pin', c.address)}
          ${hasDetails ? '' : '<p class="entry-empty">No details yet - edit to fill this in.</p>'}
        </div>
        <div class="entry-footer">
          <button class="btn flex-1 px-3 text-[13px]" data-action="edit">${icon('pencil', 'h-3.5 w-3.5')} Edit</button>
          <button class="btn btn-danger flex-1 px-3 text-[13px]" data-action="delete">${icon('trash', 'h-3.5 w-3.5')} Delete</button>
        </div>
        <div class="entry-menu" hidden>
          <button type="button" class="entry-menu-btn" data-action="edit">${icon('pencil', 'h-4 w-4')} Edit</button>
          <button type="button" class="entry-menu-btn danger" data-action="delete">${icon('trash', 'h-4 w-4')} Delete</button>
        </div>
      </article>`;
  }

  function render() {
    const grid = $('#contact-grid');
    const list = state.contacts;
    const q = state.query.trim();

    grid.innerHTML = list.map(entryHTML).join('');
    grid.classList.remove('hidden');
    attachTilt(grid);

    /* empty vs no-match state */
    const empty = $('#empty-state');
    if (list.length === 0) {
      empty.classList.remove('hidden');
      $('#empty-title').textContent = q ? 'No matches' : 'No contacts yet';
      $('#empty-text').textContent = q
        ? `Nothing found for "${q}". Try another name, phone or email.`
        : 'Add your first contact to start your book.';
      $('#empty-action').classList.toggle('hidden', Boolean(q));
    } else {
      empty.classList.add('hidden');
    }

    $('#result-hint').textContent = q
      ? `${list.length} result${list.length === 1 ? '' : 's'} for "${q}"`
      : `${list.length} contact${list.length === 1 ? '' : 's'} in your book`;

    updateStats();
  }

  function renderError(message) {
    $('#contact-grid').classList.add('hidden');
    $('#loading').classList.add('hidden');
    const empty = $('#empty-state');
    empty.classList.remove('hidden');
    $('#empty-title').textContent = 'Could not reach the API';
    $('#empty-text').textContent = message || 'Start the Python backend and reload.';
    $('#empty-action').classList.add('hidden');
  }

  function setLoading(show) {
    $('#loading').classList.toggle('hidden', !show);
    if (show) $('#contact-grid').classList.add('hidden');
  }

  /* ------------------------------------------------------------------ 3D tilt */
  function attachTilt(root) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canHover = window.matchMedia('(hover: hover)').matches;
    const wide = window.matchMedia('(min-width: 640px)');
    /* rows below sm: must never tilt - only hover-capable pointers on the card layout */
    if (reduced || !canHover || !wide.matches) return;

    $$('.tilt-card', root).forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        if (!wide.matches) {
          card.style.transform = '';
          return;
        }
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          `perspective(900px) rotateX(${(-py * 9).toFixed(2)}deg) ` +
          `rotateY(${(px * 11).toFixed(2)}deg) translateY(-4px)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }

  /* ------------------------------------------------------------------ form */
  function paintFormAvatar() {
    const preview = $('#form-avatar');
    if (!preview) return;
    /* solid circle: palette colour by id when editing, brand blue for new contacts */
    preview.style.background = state.editingId != null ? avatarColor(state.editingId) : '#1a73e8';
    if (state.formAvatar) {
      preview.innerHTML = `<img src="${esc(state.formAvatar)}" alt="Contact photo" />`;
    } else {
      const nameInput = $('#contact-form').querySelector('[name="name"]');
      preview.textContent = initials(nameInput ? nameInput.value : '');
    }
    const clearBtn = $('#avatar-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !state.formAvatar);
  }

  function openForm(contact = null) {
    const form = $('#contact-form');
    form.reset();
    CB.formDirty = false;
    state.formMode = contact ? 'edit' : 'create';
    state.editingId = contact ? contact.id : null;
    state.formAvatar = contact ? contact.avatar || '' : '';

    $('#form-title').textContent = contact ? 'Edit contact' : 'New contact';
    $('#form-submit').textContent = contact ? 'Save changes' : 'Add contact';

    if (contact) {
      FIELDS.forEach((key) => {
        const input = form.querySelector(`[name="${key}"]`);
        if (input) input.value = contact[key] || '';
      });
    }
    paintFormAvatar();
    openModal($('#form-modal'));
  }

  async function submitForm(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const val = (n) => (form.querySelector(`[name="${n}"]`) || {}).value || '';
    const payload = {
      name: val('name').trim(),
      phone: val('phone').trim(),
      email: val('email').trim(),
      company: val('company').trim(),
      address: val('address').trim(),
      notes: val('notes').trim(),
      avatar: state.formAvatar,
    };

    if (!payload.name) {
      form.querySelector('[name="name"]').focus();
      toast('Name is required', 'warn');
      return;
    }

    const btn = $('#form-submit');
    btn.disabled = true;
    try {
      if (state.formMode === 'edit') {
        await api(`/contacts/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Contact updated');
      } else {
        await api('/contacts', { method: 'POST', body: JSON.stringify(payload) });
        toast('Contact added to your book');
      }
      closeModal($('#form-modal'));
      await loadContacts();
    } catch (err) {
      toast(err.message, 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ detail */
  function detailRow(ic, label, value, href) {
    if (!value) return '';
    const body = href
      ? `<a class="break-words text-sm text-brand-2 hover:underline" href="${href}">${esc(value)}</a>`
      : `<span class="break-words text-sm text-ink">${esc(value)}</span>`;
    return `
      <div class="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <span class="mt-0.5 text-ink-dim">${icon(ic, 'h-4 w-4')}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium text-ink-dim">${label}</p>
          <div class="mt-0.5">${body}</div>
        </div>
      </div>`;
  }

  function openDetail(c) {
    state.selected = c;
    const avatarEl = $('#detail-avatar');

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

    $('#detail-name').textContent = c.name;
    $('#detail-company').textContent = c.company || 'No company listed';

    const edited = c.updated_at && c.updated_at !== c.created_at;
    $('#detail-body').innerHTML = [
      detailRow('phone', 'Phone', c.phone, c.phone ? `tel:${c.phone.replace(/\s+/g, '')}` : ''),
      detailRow('mail', 'Email', c.email, c.email ? `mailto:${c.email}` : ''),
      detailRow('building', 'Company', c.company),
      detailRow('pin', 'Address', c.address),
      detailRow('note', 'Notes', c.notes),
      `<p class="px-1 pt-1 text-xs text-ink-dim">Added ${fmtDate(c.created_at)}${edited ? ` &middot; Edited ${fmtDate(c.updated_at)}` : ''}</p>`,
    ].join('');

    openModal($('#detail-modal'));
  }

  /* ------------------------------------------------------------------ confirm */
  function confirmDialog(message) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $('#confirm-message').textContent = message;
      openModal($('#confirm-modal'));
    });
  }

  function closeConfirm(result) {
    closeModal($('#confirm-modal'));
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  }

  async function askDelete(c) {
    const ok = await confirmDialog(`Delete "${c.name}"? This can't be undone.`);
    if (!ok) return;
    try {
      await api(`/contacts/${c.id}`, { method: 'DELETE' });
      toast('Contact deleted');
      if (state.selected && state.selected.id === c.id) closeModal($('#detail-modal'));
      await loadContacts();
    } catch (err) {
      toast(err.message, 'warn');
    }
  }

  /* ------------------------------------------------------------------ UI wiring */
  function bindUI() {
    $('#fab-add').addEventListener('click', () => openForm());
    $('#empty-action').addEventListener('click', () => openForm());

    /* entry actions (delegated): view / menu / edit / delete */
    const closeMenus = (except) => {
      $$('#contact-grid .entry-menu').forEach((menu) => {
        const card = menu.closest('[data-id]');
        if (card === except) return;
        menu.setAttribute('hidden', '');
        const more = card && card.querySelector('[data-action="menu"]');
        if (more) more.setAttribute('aria-expanded', 'false');
      });
    };

    $('#contact-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('[data-id]');
      const id = card ? Number(card.dataset.id) : NaN;
      const contact = state.contacts.find((c) => c.id === id);
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
      if (!contact) return;
      if (action === 'view') openDetail(contact);
      else if (action === 'edit') openForm(contact);
      else if (action === 'delete') askDelete(contact);
    });

    /* tapping outside an entry collapses its action row */
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-id]')) closeMenus();
    });

    /* form + avatar picker */
    const form = $('#contact-form');
    form.addEventListener('submit', submitForm);
    form.addEventListener('input', () => {
      CB.formDirty = true;
    });
    form.querySelector('[name="name"]').addEventListener('input', () => {
      if (!state.formAvatar) paintFormAvatar();
    });

    $('#avatar-pick').addEventListener('click', () => $('#avatar-file').click());
    $('#avatar-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast('Please choose an image file', 'warn');
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        toast('Image is too large (max 6 MB)', 'warn');
        return;
      }
      try {
        state.formAvatar = await fileToDataUrl(file);
        CB.formDirty = true;
        paintFormAvatar();
      } catch (err) {
        toast(err.message, 'warn');
      }
    });
    $('#avatar-clear').addEventListener('click', () => {
      state.formAvatar = '';
      CB.formDirty = true;
      paintFormAvatar();
    });

    /* detail popup actions */
    $('#detail-edit').addEventListener('click', () => {
      if (!state.selected) return;
      closeModal($('#detail-modal'));
      openForm(state.selected);
    });
    $('#detail-delete').addEventListener('click', () => {
      if (state.selected) askDelete(state.selected);
    });

    /* confirm buttons */
    $('#confirm-no').addEventListener('click', () => closeConfirm(false));
    $('#confirm-yes').addEventListener('click', () => closeConfirm(true));

    /* close buttons + overlay clicks */
    $$('[data-close]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const map = { form: '#form-modal', detail: '#detail-modal' };
        closeModal($(map[btn.dataset.close]));
      })
    );
    $('#form-modal').addEventListener('click', (e) => {
      if (e.target.id === 'form-modal') closeModal($('#form-modal'));
    });
    $('#detail-modal').addEventListener('click', (e) => {
      if (e.target.id === 'detail-modal') closeModal($('#detail-modal'));
    });
    $('#confirm-modal').addEventListener('click', (e) => {
      if (e.target.id === 'confirm-modal') closeConfirm(false);
    });

    /* escape closes the top-most layer */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#confirm-modal').classList.contains('open')) closeConfirm(false);
      else if ($('#detail-modal').classList.contains('open')) closeModal($('#detail-modal'));
      else if ($('#form-modal').classList.contains('open')) closeModal($('#form-modal'));
    });
  }

  /* ------------------------------------------------------------------ boot */
  document.addEventListener('DOMContentLoaded', () => {
    const initial = (new URLSearchParams(location.search).get('q') || '').trim();
    if (initial) {
      state.query = initial;
      const input = $('#search-input');
      const shell = $('#search-shell');
      if (input) input.value = initial;
      if (shell) shell.classList.add('open', 'has-value');
      $('#search-toggle').setAttribute('aria-expanded', 'true');
    }

    CB.onSearchChange = (query) => {
      state.query = query;
      loadContacts();
    };

    bindUI();
    loadContacts();
    checkHealth();
  });
})();
