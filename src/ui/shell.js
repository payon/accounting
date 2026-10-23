/**
 * The application frame: icon rail, top bar with global search, the
 * section panel, the page outlet, and a bottom tab bar on phones.
 */
import { el, clear, announce, swap } from './dom.js';
import { icon, appMark } from './icons.js';
import { openMenu, openPopover, closeMenus } from './menu.js';
import { navigate, href, currentRoute } from './router.js';
import { applyTheme, currentTheme } from './theme.js';
import { initials } from './format.js';
import { mountSearch } from './search-box.js';
import { store } from '../lib/store.js';
import { isPuterApp } from '../lib/local.js';
import { reportMeta } from '../lib/reports.js';
import { shortcutLabel } from './shortcuts.js';

export const NAV = [
  {
    id: 'accounting', label: 'Payon', icon: 'bank',
    links: [['은행', 'banking'], ['계좌 대조', 'reconcile'], ['규칙', 'rules'], ['계정과목', 'accounts'], ['반복 거래', 'recurring'], ['감사 기록', 'audit']],
  },
  {
    id: 'expenses', label: '매입', icon: 'wallet',
    links: [['전체 매입', 'expenses'], ['매입채무', 'bills'], ['공급처', 'vendors']],
  },
  {
    id: 'sales', label: '매출', icon: 'invoice',
    links: [['전체 매출', 'sales'], ['청구서', 'invoices'], ['견적서', 'estimates'], ['고객', 'customers'], ['품목', 'items']],
  },
  {
    id: 'tax', label: '부가세', icon: 'percent',
    links: [['부가세', 'sales-tax']],
  },
];

const ROUTE_GROUP = {
  banking: 'accounting', reconcile: 'accounting', rules: 'accounting', accounts: 'accounting', register: 'accounting', recurring: 'accounting', audit: 'accounting',
  expenses: 'expenses', bills: 'expenses', vendors: 'expenses', vendor: 'expenses',
  sales: 'sales', invoices: 'sales', estimates: 'sales', customers: 'sales', customer: 'sales', items: 'sales',
  'sales-tax': 'tax',
  reports: 'reports', report: 'reports',
};

const ROUTE_LINK = { register: 'accounts', customer: 'customers', vendor: 'vendors', report: 'reports' };

const LS_PANEL = 'bookkeeping:panel';

export const CREATE_MENU = [
  { title: '매출', items: [['청구서', 'invoice', 'newInvoice'], ['결제 기록', 'payment', 'newPayment'], ['견적서', 'estimate', 'newEstimate'], ['매출 영수증', 'sales-receipt'], ['대변 메모', 'credit-memo'], ['환불 영수증', 'refund-receipt'], ['고객 추가', '@customer']] },
  { title: '매입', items: [['지출', 'expense', 'newExpense'], ['수표', 'check', 'newCheck'], ['매입채무', 'bill', 'newBill'], ['매입채무 결제', 'pay-bills'], ['발주서', 'purchase-order'], ['공급처 대변 메모', 'vendor-credit'], ['신용카드 환불', 'cc-credit'], ['공급처 추가', '@vendor']] },
  { title: 'Payon', items: [['입금', 'deposit'], ['이체', 'transfer'], ['분개', 'journal'], ['신용카드 결제', 'cc-payment'], ['품목 추가', '@item'], ['계정과목 추가', '@account']] },
  { title: '가져오기', items: [['은행 내역서', '@import'], ['고객', '@importCustomers'], ['공급처', '@importVendors'], ['품목', '@importItems']] },
];

let createHandler = () => {};
export function onCreate(fn) {
  createHandler = fn;
}

export function openCreateMenu(anchor) {
  const content = el('div.create-menu', {}, CREATE_MENU.map((col) => el('div.col', {},
    el('h3', {}, col.title),
    col.items.map(([label, target, sc]) => el('button.menu-item', { type: 'button', title: sc ? `${label} (${shortcutLabel(sc)})` : null, 'aria-keyshortcuts': sc ? shortcutLabel(sc).replace('Option', 'Alt') : null, onclick: () => createHandler(target) },
      el('span.grow', {}, label))))));
  openPopover(anchor, content, { label: '만들기', className: 'create-pop' });
}

export function mountShell(root, { user, picture, onSignOut }) {
  let collapsed = false;
  try { collapsed = localStorage.getItem(LS_PANEL) === 'collapsed'; } catch {}
  if (window.matchMedia('(max-width: 1100px)').matches) collapsed = true;

  const app = el('div.app', { class: collapsed ? 'panel-collapsed' : '' });
  const live = el('div.sr-only', { id: 'sr-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const skip = el('a.skip-link', { href: '#main' }, '본문으로 건너뛰기');
  skip.addEventListener('click', (e) => { e.preventDefault(); main.focus(); });

  // ------------------------------------------------------------- rail
  const railItem = (label, ico, target, opts = {}) => {
    const b = el(opts.button ? 'button.rail-btn' : 'a.rail-btn', {
      type: opts.button ? 'button' : null,
      href: opts.button ? null : href(target),
      class: opts.className || '',
      'aria-haspopup': opts.popup ? 'dialog' : null,
      'aria-expanded': opts.popup || opts.toggle ? 'false' : null,
      dataset: { route: target || '' },
    }, el('span.rail-ico', { html: icon(ico, 20) }), el('span', {}, label));
    return b;
  };
  const createBtn = railItem('만들기', 'plus', null, { button: true, popup: true, className: 'rail-create' });
  createBtn.addEventListener('click', () => openCreateMenu(createBtn));
  const appsBtn = railItem('메뉴', 'apps', null, { button: true, toggle: true });
  appsBtn.addEventListener('click', () => togglePanel());
  const rail = el('nav.rail', { 'aria-label': '주 메뉴' },
    el('a.rail-logo', { href: href('home'), 'aria-label': '홈', html: appMark(34) }),
    createBtn,
    railItem('홈', 'home', 'home'),
    railItem('은행', 'bank', 'banking'),
    railItem('매출', 'invoice', 'sales'),
    railItem('매입', 'wallet', 'expenses'),
    railItem('보고서', 'reports', 'reports'),
    el('div.rail-sep'),
    appsBtn,
    el('div.rail-bottom', {},
      railItem('설정', 'settings', 'settings')));

  // ------------------------------------------------------------ topbar
  const menuBtn = el('button.icon-btn.topbar-menu', { type: 'button', 'aria-label': '메뉴 열기', 'aria-expanded': 'false', html: icon('menu', 22) });
  menuBtn.addEventListener('click', () => togglePanel());
  const companyName = el('span.truncate', {}, store.settings.company?.name || '내 회사');
  const search = mountSearch();
  const searchToggle = el('button.icon-btn.show-mobile-only', { type: 'button', 'aria-label': '검색', html: icon('search', 20) });
  searchToggle.addEventListener('click', () => {
    app.classList.add('search-open');
    search.focus();
  });
  search.onClose(() => app.classList.remove('search-open'));
  const sync = el('span.sync-pill', { role: 'status', 'aria-live': 'polite' });
  const helpBtn = el('button.icon-btn.hide-mobile', { type: 'button', 'aria-label': '단축키', title: '단축키', html: icon('keyboard', 20) });
  helpBtn.addEventListener('click', () => document.dispatchEvent(new CustomEvent('shortcuts:help')));
  const settingsBtn = el('a.icon-btn.hide-mobile', { href: href('settings'), 'aria-label': '설정', title: '설정', html: icon('settings', 20) });
  const avatar = el('span.avatar', { 'aria-hidden': 'true' }, initials(store.settings.company?.name || ''));
  if (picture) avatar.replaceChildren(el('img', { src: picture, alt: '' }));
  const userBtn = el('button.icon-btn', { type: 'button', 'aria-label': `${store.settings.company?.name || '내 회사'} 계정 메뉴`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, avatar);
  userBtn.addEventListener('click', () => {
    const theme = currentTheme();
    openMenu(userBtn, [
      { header: store.settings.company?.name || '내 회사' },
      { header: '테마' },
      { label: '시스템', icon: 'monitor', checked: theme === 'system', onClick: () => setTheme('system') },
      { label: '라이트', icon: 'sun', checked: theme === 'light', onClick: () => setTheme('light') },
      { label: '다크', icon: 'moon', checked: theme === 'dark', onClick: () => setTheme('dark') },
      'sep',
      { label: '회사 설정', icon: 'settings', onClick: () => navigate('settings') },
      { label: '단축키', icon: 'keyboard', onClick: () => document.dispatchEvent(new CustomEvent('shortcuts:help')) },
      ...(isPuterApp() ? [] : ['sep', { label: '데이터 초기화', icon: 'logout', onClick: onSignOut }]),
    ], { align: 'end', label: '계정' });
  });
  const topbar = el('header.topbar', {},
    menuBtn,
    el('div.topbar-company', {}, companyName),
    search.root,
    el('div.topbar-actions', {}, sync, searchToggle, helpBtn, settingsBtn, userBtn));

  // ------------------------------------------------------------- panel
  const panel = el('nav.panel', { id: 'section-panel', 'aria-label': '섹션' });
  const panelScrim = el('div.panel-scrim', { hidden: true });
  panelScrim.addEventListener('click', () => togglePanel(false));
  const expanded = new Set();

  function renderPanel() {
    const r = currentRoute();
    const group = ROUTE_GROUP[r?.name] || null;
    if (group) expanded.add(group);
    const active = ROUTE_LINK[r?.name] || r?.name;
    // The panel is rebuilt on every page render; swap() keeps keyboard focus
    // on the same control and the scroll position stays put.
    const scroll = panel.scrollTop;
    const nodes = [];
    const collapseBtn = el('button.icon-btn', { type: 'button', 'aria-label': '패널 접기', title: '패널 접기', html: icon('panelClose', 18) });
    collapseBtn.addEventListener('click', () => togglePanel(false));
    nodes.push(el('div.panel-head', {}, el('span', {}, '섹션'), collapseBtn));
    const favs = (store.settings.favoriteReports || []).map((id) => reportMeta(id)).filter(Boolean);
    const groups = [...NAV, { id: 'reports', label: '보고서', icon: 'reports', links: [['표준 보고서', 'reports'], ...favs.map((m) => [m.title, `report/${m.id}`])] }];
    const exact = r ? `${r.name}/${r.params[0] || ''}` : '';
    const hasExact = groups.some((g) => g.links.some(([, t]) => t === exact));
    const isCurrent = (target) => (hasExact ? target === exact : target === active);
    for (const g of groups) {
      const open = expanded.has(g.id);
      const listId = `panel-${g.id}`;
      const btn = el('button.panel-group-btn', { type: 'button', 'aria-expanded': String(open), 'aria-controls': listId },
        el('span.panel-dot', { html: icon(g.icon, 13) }),
        el('span', {}, g.label),
        el('span.chev', { html: icon('chevDown', 16) }));
      const links = el('div.panel-links', { id: listId, hidden: !open },
        g.links.map(([label, target]) => el('a.panel-link', {
          href: href(target),
          'aria-current': isCurrent(target) ? 'page' : null,
        }, label)));
      // Expand and collapse in place, so the button keeps keyboard focus.
      btn.addEventListener('click', () => {
        const now = !expanded.has(g.id);
        if (now) expanded.add(g.id); else expanded.delete(g.id);
        btn.setAttribute('aria-expanded', String(now));
        links.hidden = !now;
      });
      nodes.push(el('div.panel-group', {}, btn, links));
    }
    nodes.push(el('div.panel-foot', {},
      '이 브라우저의 Payon 저장소에 저장됩니다.'));
    swap(panel, ...nodes);
    panel.scrollTop = scroll;
  }

  function togglePanel(force) {
    const open = force ?? app.classList.contains('panel-collapsed');
    app.classList.toggle('panel-collapsed', !open);
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const narrow = window.matchMedia('(max-width: 1100px)').matches;
    panelScrim.hidden = !(open && mobile);
    menuBtn.setAttribute('aria-expanded', String(open));
    appsBtn.setAttribute('aria-expanded', String(open));
    if (!narrow) {
      try { localStorage.setItem(LS_PANEL, open ? 'open' : 'collapsed'); } catch {}
    }
    if (open && (mobile || narrow)) panel.querySelector('a, button')?.focus();
  }

  // -------------------------------------------------------------- main
  const main = el('main.main', { id: 'main', tabIndex: -1 });
  const frame = el('div.frame', {}, topbar, panel, main);

  // ------------------------------------------------------------ tabbar
  const tab = (label, ico, target) => el('a.tab-btn', { href: href(target), dataset: { route: target } }, el('span.tab-ico', { html: icon(ico, 21) }), el('span', {}, label));
  const tabCreate = el('button.tab-btn.tab-create', { type: 'button', 'aria-label': '만들기', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, el('span.tab-ico', { html: icon('plus', 22) }));
  tabCreate.addEventListener('click', () => openCreateMenu(tabCreate));
  const tabbar = el('nav.tabbar', { 'aria-label': '주 메뉴' },
    tab('홈', 'home', 'home'), tab('은행', 'bank', 'banking'), tabCreate, tab('매출', 'invoice', 'sales'), tab('보고서', 'reports', 'reports'));

  app.append(skip, rail, frame, tabbar, panelScrim, live);
  clear(root).append(app);

  // ----------------------------------------------------------- updates
  function highlight() {
    const r = currentRoute();
    const name = r?.name;
    const group = ROUTE_GROUP[name];
    const railRoute = { banking: 'banking', reconcile: 'banking', rules: 'banking', register: 'banking', accounts: 'banking', recurring: 'banking', audit: 'banking', sales: 'sales', invoices: 'sales', estimates: 'sales', customers: 'sales', customer: 'sales', items: 'sales', 'sales-tax': 'sales', expenses: 'expenses', bills: 'expenses', vendors: 'expenses', vendor: 'expenses', reports: 'reports', report: 'reports', home: 'home', settings: 'settings' }[name] || (group ? null : name);
    for (const a of app.querySelectorAll('.rail-btn[data-route], .tab-btn[data-route]')) {
      const on = a.dataset.route && a.dataset.route === railRoute;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    renderPanel();
  }

  function setSync({ status, pending }) {
    sync.dataset.state = status;
    const text = status === 'saving' ? '저장 중' : status === 'offline' ? `오프라인${pending ? `, 저장 안 됨 ${pending}건` : ''}` : status === 'error' ? '저장 안 됨' : store.readOnly ? '읽기 전용' : '저장됨';
    const ico = status === 'offline' || status === 'error' ? 'offline' : status === 'saving' ? 'refresh' : 'cloud';
    sync.replaceChildren(el('span', { html: icon(ico, 15) }), el('span.sync-text', {}, text));
    sync.title = status === 'error' ? '이 브라우저의 Payon 저장소에 변경사항을 저장하지 못했습니다. 이 기기에 보관되며 나중에 다시 시도됩니다.' : text;
  }
  setSync({ status: 'idle', pending: 0 });

  function setTheme(mode) {
    applyTheme(mode);
    if (!store.readOnly) store.saveSettings({ theme: mode });
    announce(mode === 'system' ? '테마가 시스템 설정으로 지정되었습니다' : mode === 'light' ? '테마가 라이트 모드로 지정되었습니다' : '테마가 다크 모드로 지정되었습니다');
  }

  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 767px)').matches) { panelScrim.hidden = true; app.classList.remove('search-open'); }
  });

  return {
    main,
    highlight,
    setSync,
    togglePanel,
    closeMobilePanel() {
      if (window.matchMedia('(max-width: 1100px)').matches) {
        app.classList.add('panel-collapsed');
        panelScrim.hidden = true;
      }
      closeMenus();
    },
    setCompany(name) { companyName.textContent = name || '내 회사'; },
    focusSearch() { app.classList.add('search-open'); search.focus(); },
  };
}
