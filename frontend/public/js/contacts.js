'use strict';

/* ============================================================
 * Contacts page - list, stats, create / edit / delete popups
 * ============================================================ */

(function () {
  const CB = window.CB;
  const { esc, icon, initials, api, toast, fileToDataUrl, openModal, closeModal } = CB;

  const FIELDS = ['name', 'phone', 'email', 'company', 'address', 'notes', 'group'];
  const { avatarColor } = CB;

  const state = {
    contacts: [],
    query: '',
    group: '',
    selected: null,
    formMode: 'create',
    editingId: null,
    formAvatar: '',
  };

  let cachedStats = { total: 0, email: 0, recent: 0 };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ------------------------------------------------------------------ data */
  async function loadContacts() {
    setLoading(true);
    try {
      const params = [];
      const q = state.query.trim();
      if (q) params.push(`q=${encodeURIComponent(q)}`);
      if (state.group) params.push(`group=${encodeURIComponent(state.group)}`);
      state.contacts = await api(`/contacts${params.length ? `?${params.join('&')}` : ''}`);
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
  function render() {
    const grid = $('#contact-grid');
    const list = state.contacts;
    const q = state.query.trim();
    const group = state.group;

    grid.innerHTML = list.map((c, i) => CB.entryHTML(c, i)).join('');
    grid.classList.remove('hidden');
    attachTilt(grid);

    /* empty vs no-match state */
    const empty = $('#empty-state');
    if (list.length === 0) {
      empty.classList.remove('hidden');
      if (q) {
        $('#empty-title').textContent = 'No matches';
        $('#empty-text').textContent = `Nothing found for "${q}". Try another name, phone or email.`;
      } else if (group) {
        $('#empty-title').textContent = `No contacts in "${group}"`;
        $('#empty-text').textContent = 'Add a contact to this group, or pick another group.';
      } else {
        $('#empty-title').textContent = 'No contacts yet';
        $('#empty-text').textContent = 'Add your first contact to start your book.';
      }
      $('#empty-action').classList.toggle('hidden', Boolean(q || group));
    } else {
      empty.classList.add('hidden');
    }

    if (q) {
      $('#result-hint').textContent = `${list.length} result${list.length === 1 ? '' : 's'} for "${q}"`;
    } else if (group) {
      $('#result-hint').textContent = `${list.length} contact${list.length === 1 ? '' : 's'} in ${group}`;
    } else {
      $('#result-hint').textContent = `${list.length} contact${list.length === 1 ? '' : 's'} in your book`;
    }

    paintGroupFilter();
    updateStats();
  }

  /* the group pill shown while /?group=<label> is active */
  function paintGroupFilter() {
    const pill = $('#group-filter');
    if (!pill) return;
    if (!state.group) {
      pill.classList.add('hidden');
      return;
    }
    $('#group-filter-name').textContent = state.group;
    pill.classList.remove('hidden');
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
    const favoriteBox = $('#f-favorite');
    if (favoriteBox) favoriteBox.checked = Boolean(contact && contact.favorite);
    paintFormAvatar();
    fillGroupSuggestions();
    openModal($('#form-modal'));
  }

  /* existing group labels become suggestions in the form's datalist */
  async function fillGroupSuggestions() {
    const list = $('#group-list');
    if (!list) return;
    try {
      const groups = await api('/contacts/groups');
      list.innerHTML = (groups || [])
        .filter((g) => g.group && g.group !== 'Ungrouped')
        .map((g) => `<option value="${esc(g.group)}"></option>`)
        .join('');
    } catch (err) {
      /* suggestions are optional - the input still works without them */
    }
  }

  async function submitForm(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const val = (n) => (form.querySelector(`[name="${n}"]`) || {}).value || '';
    const favoriteBox = $('#f-favorite');
    const payload = {
      name: val('name').trim(),
      phone: val('phone').trim(),
      email: val('email').trim(),
      company: val('company').trim(),
      address: val('address').trim(),
      notes: val('notes').trim(),
      group: val('group').trim(),
      favorite: Boolean(favoriteBox && favoriteBox.checked),
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
  function openDetail(c) {
    state.selected = c;
    CB.paintDetail(c);
    openModal($('#detail-modal'));
  }

  /* ------------------------------------------------------------------ confirm */
  async function askDelete(c) {
    const ok = await CB.confirm(`Delete "${c.name}"? This can't be undone.`);
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

  /* ------------------------------------------------------------------ favorites */
  async function toggleFavorite(c) {
    try {
      await api(`/contacts/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ favorite: !c.favorite }),
      });
      toast(c.favorite ? 'Removed from favorites' : 'Added to favorites');
      await loadContacts();
    } catch (err) {
      toast(err.message, 'warn');
    }
  }

  /* ------------------------------------------------------------------ UI wiring */
  function bindUI() {
    $('#fab-add').addEventListener('click', () => openForm());
    $('#empty-action').addEventListener('click', () => openForm());

    /* entry actions (delegated in shared.js): view / star / menu / edit / delete */
    CB.bindEntries($('#contact-grid'), {
      find: (id) => state.contacts.find((c) => c.id === id),
      view: openDetail,
      star: toggleFavorite,
      edit: openForm,
      delete: askDelete,
    });

    /* group filter pill -> back to the unfiltered list */
    const groupClear = $('#group-filter-clear');
    if (groupClear) {
      groupClear.addEventListener('click', () => {
        location.href = '/';
      });
    }

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
    $('#confirm-no').addEventListener('click', () => CB.confirmClose(false));
    $('#confirm-yes').addEventListener('click', () => CB.confirmClose(true));

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
      if (e.target.id === 'confirm-modal') CB.confirmClose(false);
    });

    /* escape closes the top-most layer */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#confirm-modal').classList.contains('open')) CB.confirmClose(false);
      else if ($('#detail-modal').classList.contains('open')) closeModal($('#detail-modal'));
      else if ($('#form-modal').classList.contains('open')) closeModal($('#form-modal'));
    });
  }

  /* ------------------------------------------------------------------ boot */
  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const initial = (params.get('q') || '').trim();
    const group = (params.get('group') || '').trim();
    const editId = Number(params.get('edit'));

    if (initial) {
      state.query = initial;
      const input = $('#search-input');
      const shell = $('#search-shell');
      if (input) input.value = initial;
      if (shell) shell.classList.add('open', 'has-value');
      $('#search-toggle').setAttribute('aria-expanded', 'true');
    }
    if (group) state.group = group;

    CB.onSearchChange = (query) => {
      state.query = query;
      loadContacts();
    };

    bindUI();
    loadContacts().then(() => {
      /* /?edit=<id> opens the editor for one contact (used by Favorites) */
      if (Number.isFinite(editId) && editId > 0) {
        const target = state.contacts.find((c) => c.id === editId);
        if (target) openForm(target);
      }
    });
    checkHealth();
  });
})();
