'use strict';

/* ============================================================
 * Groups page - one chip per group, with its contact count
 * ------------------------------------------------------------
 * A chip links to /?group=<label>, where the Contacts page
 * filters its list with the shared group pill.
 * ============================================================ */

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const CB = window.CB;
    const { api, esc } = CB;

    const $ = (sel) => document.querySelector(sel);

    function render(groups) {
      const chips = $('#group-chips');

      chips.innerHTML = groups
        .map(
          (g) => `
        <a class="chip" href="/?group=${encodeURIComponent(g.group)}">
          ${esc(g.group)}
          <span class="chip-count">${g.count}</span>
        </a>`
        )
        .join('');
      chips.classList.remove('hidden');

      const empty = $('#groups-empty');
      empty.classList.toggle('hidden', groups.length !== 0);

      $('#groups-hint').textContent =
        groups.length === 0
          ? 'No groups in your book yet'
          : `${groups.length} group${groups.length === 1 ? '' : 's'} in your book`;
    }

    function renderError(message) {
      $('#group-chips').classList.add('hidden');
      const empty = $('#groups-empty');
      empty.classList.remove('hidden');
      $('#groups-hint').textContent = message || 'Could not reach the API';
    }

    async function loadGroups() {
      $('#groups-loading').classList.remove('hidden');
      try {
        const groups = await api('/contacts/groups');
        render(Array.isArray(groups) ? groups : []);
        CB.setApiStatus(true);
      } catch (err) {
        CB.setApiStatus(false, err.message);
        renderError(err.message);
      } finally {
        $('#groups-loading').classList.add('hidden');
      }
    }

    loadGroups();
  });
})();
