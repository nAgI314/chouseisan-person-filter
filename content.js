(() => {
  'use strict';

  if (typeof window !== 'undefined') {
    if (window.__csPersonFilterInitialized) return;
    window.__csPersonFilterInitialized = true;
  }

  const SELECTORS = {
    table: '#nittei',
    tableArea: '#tableArea',
    memberCell: '[id^="member_"]',
    memberLink: '[id^="member_"] a',
  };

  const PANEL_ID = 'cs-person-filter-host';
  const CELL_CLASS = 'cs-cell-match';
  const ROW_CLASS = 'cs-row-match';
  const HIDDEN_CLASS = 'cs-row-hidden';

  const state = {
    model: null,
    selected: new Set(),
    statuses: new Set(['○', '△']),
    swapped: false,
    suggestionsOpen: false,
    activeSuggestion: -1,
    suggestions: [],
    els: null,
  };

  let refreshTimer = 0;
  let blurTimer = 0;
  let observer = null;

  function parseTable(table) {
    if (!table || !table.rows || table.rows.length === 0) return null;

    const headerRow = table.rows[0];
    const headerCells = Array.from(headerRow.cells);
    const members = [];

    for (const cell of headerCells) {
      if (!cell.id || !cell.id.startsWith('member_')) continue;
      const link = cell.querySelector('a');
      const name = (link ? link.textContent : cell.textContent || '').trim();
      members.push({
        index: members.length,
        cellIndex: headerCells.indexOf(cell),
        id: cell.id,
        name: name || '(名前なし)',
        label: '',
      });
    }

    if (members.length === 0) return null;

    const nameCounts = new Map();
    for (const member of members) {
      nameCounts.set(member.name, (nameCounts.get(member.name) || 0) + 1);
    }

    const seen = new Map();
    for (const member of members) {
      if (nameCounts.get(member.name) === 1) {
        member.label = member.name;
        continue;
      }
      const n = (seen.get(member.name) || 0) + 1;
      seen.set(member.name, n);
      member.label = `${member.name} (${n})`;
    }

    const dates = [];
    for (let r = 1; r < table.rows.length; r++) {
      const row = table.rows[r];
      const cells = Array.from(row.cells);
      if (cells.length <= members[0].cellIndex) continue;

      const label = (cells[0].textContent || '').trim();
      if (!label || label === 'コメント' || label === 'Comment') continue;

      const marks = members.map((member) => {
        const cell = cells[member.cellIndex];
        if (!cell) return '-';
        const img = cell.querySelector('img');
        if (!img) return '-';
        const src = img.getAttribute('src') || '';
        if (src.includes('mark-ok')) return '○';
        if (src.includes('mark-tri')) return '△';
        if (src.includes('mark-x')) return '×';
        return '-';
      });

      dates.push({
        index: dates.length,
        rowIndex: r,
        label,
        marks,
      });
    }

    return { members, dates };
  }

  function isSwapped(table) {
    if (!table || !table.rows || table.rows.length === 0) return false;
    const firstMemberCell = table.querySelector(SELECTORS.memberCell);
    if (!firstMemberCell) return false;
    return firstMemberCell.parentElement !== table.rows[0];
  }

  function init() {
    if (!/^\/s\/?$/.test(window.location.pathname)) return;
    document.addEventListener('click', onDocumentClick, true);
    startObserver();
    refresh();
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        const target = mutation.target;
        const element = target.nodeType === 1 ? target : target.parentElement;
        if (!element) continue;
        const touchesTable =
          element.closest(SELECTORS.tableArea) ||
          element.id === 'tableArea' ||
          (element.matches && element.matches(SELECTORS.table)) ||
          (element.querySelector && element.querySelector(SELECTORS.table));
        if (touchesTable || !document.getElementById(PANEL_ID)) {
          scheduleRefresh();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      refresh();
    }, 150);
  }

  function refresh() {
    const table = document.querySelector(SELECTORS.table);
    if (!table) return;

    state.swapped = isSwapped(table);
    state.model = state.swapped ? null : parseTable(table);

    if (!state.swapped && state.model) {
      const ids = new Set(state.model.members.map((member) => member.id));
      for (const id of Array.from(state.selected)) {
        if (!ids.has(id)) state.selected.delete(id);
      }
    }

    ensurePanel();
    renderPanel();
    applyHighlights();
  }

  function ensurePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing && existing.isConnected) return existing;
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = PANEL_ID;

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          display: block;
        }
        .panel {
          position: relative;
          z-index: 10;
          box-sizing: border-box;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 12px;
          margin: 0 0 12px;
          padding: 10px 12px;
          border: 1px solid #b7d8b7;
          border-radius: 8px;
          background: #f4faf4;
          color: #1f3d1f;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
          font-size: 13px;
          line-height: 1.4;
        }
        .title {
          font-weight: 700;
          white-space: nowrap;
        }
        .hint {
          color: #5a6b5a;
          font-size: 11px;
          white-space: nowrap;
        }
        .field {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .label {
          color: #4b5f4b;
          font-size: 12px;
          white-space: nowrap;
        }
        .members {
          flex: 1 1 280px;
          flex-wrap: wrap;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 180px;
          padding: 2px 4px 2px 8px;
          border-radius: 999px;
          background: #dcefdc;
          color: #1f3d1f;
          font-size: 12px;
        }
        .chip-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .chip-remove {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: #1f3d1f;
          cursor: pointer;
          font: inherit;
          line-height: 1;
        }
        .chip-remove:hover {
          background: rgba(31, 61, 31, 0.12);
        }
        .input-wrap {
          position: relative;
          flex: 1 1 180px;
          min-width: 150px;
        }
        input[type="text"] {
          box-sizing: border-box;
          width: 100%;
          padding: 5px 8px;
          border: 1px solid #9fc59f;
          border-radius: 6px;
          background: #fff;
          color: #1f3d1f;
          font: inherit;
        }
        input[type="text"]:focus {
          outline: 2px solid #2e7d32;
          outline-offset: 1px;
        }
        .suggestions {
          position: absolute;
          z-index: 20;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          max-height: 220px;
          margin: 0;
          padding: 4px;
          overflow-y: auto;
          list-style: none;
          border: 1px solid #9fc59f;
          border-radius: 6px;
          background: #fff;
          box-shadow: 0 6px 18px rgba(20, 50, 20, 0.18);
        }
        .suggestions[hidden] {
          display: none;
        }
        .suggestion {
          padding: 5px 8px;
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .suggestion:hover,
        .suggestion.active {
          background: #dcefdc;
        }
        .status {
          gap: 8px;
        }
        .status label {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          cursor: pointer;
          white-space: nowrap;
        }
        input[type="checkbox"] {
          accent-color: #2e7d32;
          margin: 0;
        }
        .clear {
          padding: 4px 10px;
          border: 1px solid #9fc59f;
          border-radius: 6px;
          background: #fff;
          color: #1f3d1f;
          cursor: pointer;
          font: inherit;
        }
        .clear:hover {
          background: #e8f4e8;
        }
        .note {
          flex-basis: 100%;
          margin: 0;
          padding: 6px 8px;
          border-radius: 6px;
          background: #fff4e0;
          color: #8a4b00;
          font-size: 12px;
        }
        .note[hidden] {
          display: none;
        }
      </style>
      <div class="panel" role="group" aria-label="フィルタ">
        <span class="title">フィルタ</span>
        <span class="hint">Shift+クリックでも追加</span>
        <div class="field members">
          <span class="label">参加者</span>
          <div class="chips"></div>
          <div class="input-wrap">
            <input type="text" placeholder="名前を入力" autocomplete="off" aria-label="参加者名">
            <ul class="suggestions" hidden></ul>
          </div>
        </div>
        <div class="field status">
          <span class="label">回答</span>
          <label><input type="checkbox" value="○" checked> ○</label>
          <label><input type="checkbox" value="△" checked> △</label>
          <label><input type="checkbox" value="×"> ×</label>
        </div>
        <button type="button" class="clear">クリア</button>
        <p class="note" hidden></p>
      </div>
    `;

    const els = {
      chips: shadow.querySelector('.chips'),
      input: shadow.querySelector('input[type="text"]'),
      suggestions: shadow.querySelector('.suggestions'),
      statusInputs: Array.from(shadow.querySelectorAll('.status input')),
      clear: shadow.querySelector('.clear'),
      note: shadow.querySelector('.note'),
    };
    state.els = els;

    bindPanel(els);
    insertPanel(host);
    return host;
  }

  function insertPanel(host) {
    const tableArea = document.querySelector(SELECTORS.tableArea);
    if (tableArea && tableArea.parentElement) {
      tableArea.parentElement.insertBefore(host, tableArea);
      return;
    }
    const table = document.querySelector(SELECTORS.table);
    if (table && table.parentElement) {
      table.parentElement.insertBefore(host, table);
      return;
    }
    document.body.appendChild(host);
  }

  function bindPanel(els) {
    els.input.addEventListener('focus', () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      state.suggestionsOpen = true;
      state.activeSuggestion = -1;
      renderSuggestions(els.input.value);
    });

    els.input.addEventListener('input', () => {
      state.suggestionsOpen = true;
      state.activeSuggestion = -1;
      renderSuggestions(els.input.value);
    });

    els.input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSuggestion(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSuggestion(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const target = state.suggestions[state.activeSuggestion] || state.suggestions[0];
        if (target) addMember(target.id);
        else addMemberByName(els.input.value);
      } else if (event.key === 'Escape') {
        state.suggestionsOpen = false;
        hideSuggestions();
      }
    });

    els.input.addEventListener('blur', () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        blurTimer = 0;
        state.suggestionsOpen = false;
        hideSuggestions();
      }, 120);
    });

    els.suggestions.addEventListener('pointerdown', (event) => {
      const item = event.target.closest('[data-member-id]');
      if (!item) return;
      event.preventDefault();
      addMember(item.dataset.memberId);
    });

    for (const input of els.statusInputs) {
      input.addEventListener('change', () => {
        state.statuses = new Set(
          els.statusInputs.filter((item) => item.checked).map((item) => item.value)
        );
        applyHighlights();
      });
    }

    els.clear.addEventListener('click', () => {
      state.selected.clear();
      state.statuses = new Set(['○', '△']);
      state.suggestionsOpen = false;
      els.input.value = '';
      hideSuggestions();
      renderPanel();
      applyHighlights();
    });

    els.chips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-id]');
      if (!button) return;
      state.selected.delete(button.dataset.removeId);
      renderPanel();
      applyHighlights();
    });
  }

  function renderPanel() {
    const els = state.els;
    if (!els) return;

    renderChips();
    const root = els.input.getRootNode();
    if (state.suggestionsOpen && root.activeElement === els.input) renderSuggestions(els.input.value);
    else hideSuggestions();
    renderNote();

    for (const input of els.statusInputs) {
      input.checked = state.statuses.has(input.value);
    }
  }

  function renderChips() {
    const els = state.els;
    if (!els) return;
    els.chips.textContent = '';
    if (!state.model) return;

    for (const member of state.model.members) {
      if (!state.selected.has(member.id)) continue;
      const chip = document.createElement('span');
      chip.className = 'chip';

      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = member.label;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.dataset.removeId = member.id;
      remove.setAttribute('aria-label', `${member.label}を外す`);
      remove.textContent = '×';

      chip.append(name, remove);
      els.chips.appendChild(chip);
    }
  }

  function renderSuggestions(query) {
    const els = state.els;
    if (!els || !state.model) {
      hideSuggestions();
      return;
    }

    const normalized = (query || '').trim().toLowerCase();
    const items = state.model.members
      .filter((member) => !state.selected.has(member.id))
      .filter((member) => !normalized || member.name.toLowerCase().includes(normalized))
      .slice(0, 8);

    state.suggestions = items;
    if (state.activeSuggestion >= items.length) state.activeSuggestion = items.length - 1;

    els.suggestions.textContent = '';
    if (items.length === 0) {
      hideSuggestions();
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const member = items[i];
      const item = document.createElement('li');
      item.className = 'suggestion';
      item.dataset.memberId = member.id;
      item.textContent = member.label;
      if (i === state.activeSuggestion) item.classList.add('active');
      els.suggestions.appendChild(item);
    }
    els.suggestions.hidden = false;
  }

  function hideSuggestions() {
    const els = state.els;
    if (!els) return;
    els.suggestions.hidden = true;
    state.activeSuggestion = -1;
  }

  function moveSuggestion(delta) {
    if (state.suggestions.length === 0) return;
    const next = state.activeSuggestion + delta;
    state.activeSuggestion = Math.max(0, Math.min(state.suggestions.length - 1, next));
    const items = state.els.suggestions.querySelectorAll('.suggestion');
    items.forEach((item, index) => {
      const active = index === state.activeSuggestion;
      item.classList.toggle('active', active);
      if (active) item.scrollIntoView({ block: 'nearest' });
    });
  }

  function addMemberByName(query) {
    if (!state.model) return;
    const normalized = (query || '').trim().toLowerCase();
    if (!normalized) return;

    const exact = state.model.members.find(
      (member) => !state.selected.has(member.id) && member.name.toLowerCase() === normalized
    );
    const partial = state.model.members.find(
      (member) => !state.selected.has(member.id) && member.name.toLowerCase().includes(normalized)
    );
    const target = exact || partial;
    if (target) addMember(target.id);
  }

  function addMember(id) {
    if (!state.model) return;
    if (!state.model.members.some((member) => member.id === id)) return;

    state.selected.add(id);
    state.suggestionsOpen = true;

    const els = state.els;
    if (els) {
      els.input.value = '';
      els.input.focus();
    }
    renderPanel();
    applyHighlights();
  }

  function toggleMember(id) {
    if (!state.model) return;
    if (!state.model.members.some((member) => member.id === id)) return;

    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    renderPanel();
    applyHighlights();
  }

  function renderNote() {
    const els = state.els;
    if (!els) return;

    if (state.swapped) {
      els.note.hidden = false;
      els.note.textContent = '行と列が入れ替わっています。通常表示に戻すと使えます。';
      return;
    }
    els.note.hidden = true;
    els.note.textContent = '';
  }

  function applyHighlights() {
    const table = document.querySelector(SELECTORS.table);
    if (!table) return;

    for (const cell of table.querySelectorAll(`.${CELL_CLASS}`)) {
      cell.classList.remove(CELL_CLASS);
    }
    for (const row of table.querySelectorAll(`.${ROW_CLASS}`)) {
      row.classList.remove(ROW_CLASS);
    }
    for (const row of table.querySelectorAll(`.${HIDDEN_CLASS}`)) {
      row.classList.remove(HIDDEN_CLASS);
    }

    if (state.swapped || !state.model || state.selected.size === 0 || state.statuses.size === 0) {
      return;
    }

    const selectedMembers = state.model.members.filter((member) => state.selected.has(member.id));

    for (const date of state.model.dates) {
      const row = table.rows[date.rowIndex];
      if (!row) continue;
      const cells = row.cells;
      let allMatch = true;

      for (const member of selectedMembers) {
        const cell = cells[member.cellIndex];
        const mark = date.marks[member.index];
        if (cell && state.statuses.has(mark)) {
          cell.classList.add(CELL_CLASS);
        } else {
          allMatch = false;
        }
      }

      if (allMatch) {
        row.classList.add(ROW_CLASS);
      } else {
        row.classList.add(HIDDEN_CLASS);
      }
    }
  }

  function onDocumentClick(event) {
    if (!event.shiftKey) return;
    const target = event.target;
    if (!target || target.nodeType !== 1) return;

    const link = target.closest(SELECTORS.memberLink);
    if (!link) return;
    const cell = link.closest(SELECTORS.memberCell);
    if (!cell || !cell.id) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    toggleMember(cell.id);
  }

  const api = { parseTable, isSwapped };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  if (typeof document !== 'undefined') {
    init();
  }
})();
