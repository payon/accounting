/**
 * Keyboard shortcuts: Ctrl+Alt (Ctrl+Option on a Mac) plus a letter, matched
 * on the physical key (e.code) so they work on every keyboard layout and with
 * Option's dead keys on macOS.
 */
import { el } from './dom.js';
import { isMac } from './dom.js';
import { openDialog, topLayer } from './dialog.js';

const MOD = isMac ? 'Ctrl+Option' : 'Ctrl+Alt';

export const GLOBAL = [
  { id: 'newInvoice', code: 'KeyI', label: '새 청구서' },
  { id: 'newPayment', code: 'KeyR', label: '결제 기록' },
  { id: 'newEstimate', code: 'KeyE', label: '새 견적서' },
  { id: 'newExpense', code: 'KeyX', label: '새 지출' },
  { id: 'newCheck', code: 'KeyW', label: '새 수표' },
  { id: 'newBill', code: 'KeyB', label: '새 매입채무' },
  { id: 'newJournal', code: 'KeyJ', label: '새 분개' },
  { id: 'customers', code: 'KeyC', label: '고객' },
  { id: 'vendors', code: 'KeyV', label: '공급처' },
  { id: 'accounts', code: 'KeyA', label: '계정과목' },
  { id: 'items', code: 'KeyL', label: '품목' },
  { id: 'banking', code: 'KeyK', label: '은행' },
  { id: 'reports', code: 'KeyP', label: '보고서' },
  { id: 'home', code: 'KeyH', label: '홈' },
  { id: 'search', code: 'KeyF', label: '거래 검색' },
  { id: 'help', code: 'Slash', label: '단축키 보기' },
];

export const FORM = [
  { id: 'saveNew', code: 'KeyS', label: '저장 후 새로 만들기' },
  { id: 'saveClose', code: 'KeyD', label: '저장 후 닫기' },
  { id: 'print', code: 'KeyN', label: '인쇄' },
  { id: 'addLine', code: 'KeyG', label: '행 추가' },
];

export function shortcutLabel(id) {
  const s = [...GLOBAL, ...FORM].find((x) => x.id === id);
  if (!s) return '';
  const key = s.code === 'Slash' ? '/' : s.code.replace('Key', '');
  return `${MOD}+${key}`;
}

const handlers = new Map();
const formHandlers = [];

export function onShortcut(id, fn) {
  handlers.set(id, fn);
}

/** A form registers its own handlers while it is open. Returns an unregister function. */
export function pushFormShortcuts(map) {
  formHandlers.push(map);
  return () => {
    const i = formHandlers.indexOf(map);
    if (i >= 0) formHandlers.splice(i, 1);
  };
}

function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    // "/" focuses search, like most web apps, when not already typing.
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e) && !topLayer()) {
      e.preventDefault();
      handlers.get('search')?.();
      return;
    }
    if (e.key === '?' && !isTyping(e) && !topLayer()) {
      e.preventDefault();
      showHelp();
      return;
    }
    if (!(e.ctrlKey && e.altKey) || e.metaKey) return;
    // AltGr reports as Ctrl+Alt on Windows; it is a character, not a shortcut.
    if (e.getModifierState?.('AltGraph')) return;
    const form = formHandlers[formHandlers.length - 1];
    // A confirm or picker sitting on top of a form gets the keys, not the form.
    if (form?.layer && topLayer() !== form.layer) return;
    if (form) {
      const f = FORM.find((s) => s.code === e.code);
      if (f && form[f.id]) {
        e.preventDefault();
        form[f.id]();
        return;
      }
    }
    const g = GLOBAL.find((s) => s.code === e.code);
    // Over a form, keys that would change or search the page hidden behind it
    // are left alone: only "new ..." (another form on top) and the shortcut list.
    if (topLayer() && (!form || !g || !(g.id.startsWith('new') || g.id === 'help'))) return;
    if (g && handlers.has(g.id)) {
      e.preventDefault();
      handlers.get(g.id)();
    }
  });
  document.addEventListener('shortcuts:help', showHelp);
}

function table(caption, list) {
  return el('table.grid.shortcut-table', {},
    el('caption', {}, caption),
    el('tbody', {}, list.map((s) => el('tr', {}, el('td', {}, s.label), el('td.num', {}, el('kbd', {}, shortcutLabel(s.id)))))));
}

export function showHelp() {
  openDialog({
    title: '단축키',
    wide: true,
    body: el('div.shortcut-grid', {},
      table('어디서든', GLOBAL),
      el('div', {},
        table('거래 양식에서', FORM),
        el('table.grid.shortcut-table', {},
          el('caption', {}, '날짜 입력란에서'),
          el('tbody', {}, [
            ['다음 날 / 이전 날', '+  /  -'], ['오늘', 'T'], ['주 시작일 / 마지막 날', 'W  /  K'],
            ['월 시작일 / 마지막 날', 'M  /  H'], ['연도 시작일 / 마지막 날', 'Y  /  R'],
          ].map(([a, b]) => el('tr', {}, el('td', {}, a), el('td.num', {}, el('kbd', {}, b)))))),
        el('table.grid.shortcut-table', {},
          el('caption', {}, '기타'),
          el('tbody', {}, [['검색', '/'], ['이 목록', '?'], ['대화상자나 양식 닫기', 'Esc']].map(([a, b]) => el('tr', {}, el('td', {}, a), el('td.num', {}, el('kbd', {}, b)))))))),
  });
}
