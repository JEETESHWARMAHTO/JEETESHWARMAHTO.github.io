'use strict';

/* ============================================================
 * Favorites page - the starred contacts
 * ------------------------------------------------------------
 * Reuses CB.entryHTML / CB.bindEntries / CB.paintDetail from
 * shared.js so an entry looks and behaves exactly like it does
 * on the Contacts page. The star here always removes.
 * ============================================================ */

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const CB = window.CB;
    const { api, toast, closeModal } = CB;

    const $ = (sel) => document.querySelector(sel);

    const state = { contacts: [] };

    /* ------------------------------------------------------------------ data */
    async function loadFavorites() {
      $('#loading').classList.remove('hidden');
      $('#contact-grid').classList.add('hidden');
      try {
        state.contacts = await api('/contacts/favorites');
        render();
        CB.setApiStatus(true);
      } catch (err) {
        CB.setApiStatus(false, err.message);
        renderError(err.message);
      } finally {
        $('#loading').classList.add('hidden');
      }
    }

    /* ------------------------------------------------------------------ render */
    function render() {
      const grid = $('#contact-grid');
      const list = state.contacts;

      grid.innerHTML = list.map((c, i) => CB.entryHTML(c, i)).join('');
      grid.classList.remove('hidden');

      const empty = $('#empty-state');
      empty.classList.toggle('hidden', list.length !== 0);
      if (list.length === 0) $('#empty-action').classList.remove('hidden');

      $('#result-hint').textContent =
        `${list.length} favorite${list.length === 1 ? '' : 's'} in your book`;
    }

    function renderError(message) {
      $('#contact-grid').classList.add('hidden');
      const empty = $('#empty-state');
      empty.classList.remove('hidden');
      $('#empty-title').textContent = 'Could not reach the API';
      $('#empty-text').textContent = message || 'Start the Python backend and reload.';
      $('#empty-action').classList.add('hidden');
    }

    /* ------------------------------------------------------------------ actions */
    async function removeFavorite(c) {
      try {
        await api(`/contacts/${c.id}`, {
          method: 'PUT',
          body: JSON.stringify({ favorite: false }),
        });
        toast('Removed from favorites');
        await loadFavorites();
      } catch (err) {
        toast(err.message, 'warn');
      }
    }

    async function removeContact(c) {
      const ok = await CB.confirm(`Delete "${c.name}"? This can't be undone.`);
      if (!ok) return;
      try {
        await api(`/contacts/${c.id}`, { method: 'DELETE' });
        toast('Contact deleted');
        closeModal($('#detail-modal'));
        await loadFavorites();
      } catch (err) {
        toast(err.message, 'warn');
      }
    }

    /* editing happens on the Contacts page, which owns the form modal */
    const editContact = (c) => {
      location.href = `/?edit=${c.id}`;
    };

    /* ------------------------------------------------------------------ wiring */
    CB.bindEntries($('#contact-grid'), {
      find: (id) => state.contacts.find((c) => c.id === id),
      view: (c) => CB.openDetail(c),
      star: removeFavorite,
      edit: editContact,
      delete: removeContact,
    });

    $('#detail-edit').addEventListener('click', () => {
      if (CB.detail) editContact(CB.detail);
    });
    $('#detail-delete').addEventListener('click', () => {
      if (CB.detail) removeContact(CB.detail);
    });

    document.querySelectorAll('[data-close="detail"]').forEach((btn) =>
      btn.addEventListener('click', () => closeModal($('#detail-modal')))
    );
    $('#detail-modal').addEventListener('click', (e) => {
      if (e.target.id === 'detail-modal') closeModal($('#detail-modal'));
    });

    $('#confirm-no').addEventListener('click', () => CB.confirmClose(false));
    $('#confirm-yes').addEventListener('click', () => CB.confirmClose(true));
    $('#confirm-modal').addEventListener('click', (e) => {
      if (e.target.id === 'confirm-modal') CB.confirmClose(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#confirm-modal').classList.contains('open')) CB.confirmClose(false);
      else if ($('#detail-modal').classList.contains('open')) closeModal($('#detail-modal'));
    });

    loadFavorites();
  });
})();
