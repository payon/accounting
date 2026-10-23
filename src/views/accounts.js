/** Chart of accounts, and an account's register. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable } from '../ui/table.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { navigate } from '../ui/router.js';
import { download } from '../ui/dom.js';
import { selectInput } from '../ui/fields.js';
import { pageHead, splitButton, searchBox, emptyState, viewState } from './page.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES, isBalanceSheet, typeInfo, descendantIds } from '../lib/accounts.js';
import { typeLabel } from '../lib/txn.js';
import { PERIODS, periodRange, today } from '../lib/dates.js';
import { toCSV } from '../lib/csv.js';
import { openAccountForm } from '../forms/account.js';
import { openTxn, openTxnForm } from '../forms/index.js';

export function renderAccounts(main) {
  const st = viewState('accounts', { q: '', type: 'all', show: 'active' });
  const q = st.q.trim().toLowerCase();
  const rows = store.chart({ includeInactive: st.show !== 'active' })
    .filter(({ account: a }) => (st.type === 'all' || a.type === st.type) && (st.show !== 'inactive' || a.active === false))
    .filter(({ account: a }) => !q || `${a.number || ''} ${a.name} ${a.description || ''}`.toLowerCase().includes(q));
  const bankBalances = new Map();
  for (const l of store.bankLines.values()) bankBalances.set(l.accountId, true);
  const columns = [
    { key: 'name', label: '이름', primary: true, render: ({ account: a, depth }) => el('div', { style: { paddingLeft: `${depth * 20}px` } }, el('span.cell-main', {}, a.number ? `${a.number} ` : '', a.name), a.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, '비활성') : null, a.role ? el('span.sr-only', {}, ' (시스템 계정)') : null), sortable: false },
    { key: 'type', label: '계정 유형', render: ({ account: a }) => ACCOUNT_TYPES[a.type].label, sortable: false },
    { key: 'desc', label: '설명', hideMobile: true, render: ({ account: a }) => el('span.truncate', { style: { maxWidth: '260px', display: 'inline-block' } }, a.description || ''), sortable: false },
    { key: 'balance', label: '잔액', align: 'right', amount: true, render: ({ account: a }) => (isBalanceSheet(a.type) ? amountNode(store.accountBalance(a.id, { includeSubs: false })) : ''), sortable: false },
    {
      key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false,
      render: ({ account: a }) => {
        const more = el('button.icon-btn', { type: 'button', 'aria-label': `${a.name} 추가 작업`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: icon('chevDown', 16) });
        more.addEventListener('click', () => openMenu(more, [
          { label: '편집', icon: 'pencil', onClick: () => openAccountForm({ account: a }) },
          { label: '보고서 실행', icon: 'reports', onClick: () => navigate(`report/gl?accounts=${a.id}`) },
          a.type === 'bank' || a.type === 'creditCard' ? { label: '계좌 대조', icon: 'scale', onClick: () => navigate(`reconcile/${a.id}`) } : null,
          a.active === false ? { label: '다시 활성화', onClick: () => store.saveAccount({ ...a, active: true }) } : null,
          !a.role ? { label: a.active === false ? '삭제' : '비활성화 또는 삭제', icon: 'trash', danger: true, onClick: () => removeAccount(a) } : null,
        ].filter(Boolean), { align: 'end' }));
        return el('div.row', { style: { justifyContent: 'flex-end' } },
          el('a.row-link', { href: `#/register/${a.id}` }, isBalanceSheet(a.type) ? '원장 보기' : '보고서 실행'), more);
      },
    },
  ];
  const table = dataTable({
    columns, rows, rowKey: (r) => r.account.id, ariaLabel: '계정과목',
    onRowClick: (r) => navigate(`register/${r.account.id}`),
    empty: emptyState({ iconName: 'bank', title: '일치하는 계정과목이 없습니다', text: '다른 필터를 시도해 보세요.' }),
  });
  const exportCsv = () => download(toCSV([['계정번호', '이름', '유형', '설명', '잔액'], ...rows.map(({ account: a }) => [a.number || '', store.accountName(a.id, { withNumber: false }), ACCOUNT_TYPES[a.type].label, a.description || '', isBalanceSheet(a.type) ? (store.accountBalance(a.id, { includeSubs: false }) / 100).toFixed(2) : ''])]), `chart-of-accounts-${today()}.csv`, 'text/csv');
  swap(main, el('div.page', {},
    pageHead({ title: '계정과목', crumbs: [['Payon', 'accounts'], ['계정과목']], actions: [el('a.btn', { href: '#/report/accountList' }, '보고서 실행'), splitButton('새 계정', () => openAccountForm(), [{ label: 'CSV로 내보내기', icon: 'download', onClick: exportCsv }])] }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: '이름이나 계정번호로 필터', label: '계정과목 필터', onInput: (v) => { st.q = v; renderAccounts(main); main.querySelector('input[type="search"]')?.focus(); } }),
      selectInput({ options: [['all', '모든 계정 유형'], ...Object.entries(ACCOUNT_TYPES).map(([k, v]) => [k, v.label])], value: st.type, ariaLabel: '계정 유형', onChange: (v) => { st.type = v; renderAccounts(main); } }),
      selectInput({ options: [['active', '활성'], ['all', '전체'], ['inactive', '비활성']], value: st.show, ariaLabel: '표시', onChange: (v) => { st.show = v; renderAccounts(main); } }),
      el('div.toolbar-end', {}, el('button.icon-btn', { type: 'button', 'aria-label': 'CSV로 내보내기', title: 'CSV로 내보내기', html: icon('download', 18), onclick: exportCsv }), el('button.icon-btn', { type: 'button', 'aria-label': '인쇄', title: '인쇄', html: icon('printer', 18), onclick: () => window.print() }))),
    table.root));
}

async function removeAccount(a) {
  const inUse = store.accountInUse(a.id);
  const ok = await confirmDialog({
    title: inUse ? `${a.name} 계정을 비활성화하시겠습니까?` : `${a.name} 계정을 삭제하시겠습니까?`,
    message: inUse ? '이 계정에는 거래나 하위 계정이 있어 비활성화됩니다. 기록은 보고서에 그대로 남습니다.' : '이 계정에는 거래가 없으며 완전히 삭제됩니다.',
    confirmLabel: inUse ? '비활성화' : '삭제', danger: !inUse,
  });
  if (!ok) return;
  try {
    const r = store.deleteAccount(a.id);
    toast(r === 'inactive' ? '계정이 비활성화되었습니다' : '계정이 삭제되었습니다');
  } catch (err) { toastError(err); }
}

export function renderRegister(main, route) {
  const a = store.account(route.params[0]);
  if (!a) {
    swap(main, el('div.page', {}, emptyState({ title: '계정을 찾을 수 없습니다', action: el('a.btn', { href: '#/accounts' }, '계정과목') })));
    return;
  }
  const st = viewState(`register:${a.id}`, { period: 'all', q: '', subs: true });
  const range = periodRange(st.period, { now: today(), fiscalStartMonth: store.settings.fiscalStartMonth });
  const ids = st.subs ? [...descendantIds(a.id, [...store.accounts.values()])] : [a.id];
  const L = store.ledger('accrual');
  const reg = L.register(ids, range);
  const sign = typeInfo(a.type).sign;
  const bs = isBalanceSheet(a.type);
  const q = st.q.trim().toLowerCase();
  let rows = reg.rows;
  if (q) rows = rows.filter((r) => `${r.txn.num || ''} ${store.contactName(r.txn.contactId)} ${r.memo || r.txn.memo || ''} ${typeLabel(r.txn.type)}`.toLowerCase().includes(q));
  rows = rows.slice().reverse();
  const card = a.type === 'creditCard';
  const liability = sign < 0;
  const incLabel = a.type === 'bank' ? '입금' : card ? '사용 금액' : liability ? '증가' : '증가';
  const decLabel = a.type === 'bank' ? '지급' : card ? '결제' : '감소';
  const columns = [
    { key: 'date', label: '날짜', render: (r) => dateText(r.txn.date), sortable: false },
    { key: 'num', label: '참조번호', hideMobile: true, render: (r) => r.txn.num || r.txn.ref || '', sortable: false },
    { key: 'type', label: '유형', render: (r) => typeLabel(r.txn.type), sortable: false },
    { key: 'payee', label: '거래처', primary: true, render: (r) => el('span.cell-main', {}, store.contactName(r.txn.contactId) || ''), sortable: false },
    { key: 'acct', label: '계정', hideMobile: true, render: (r) => store.splitName(r.txn, a.id), sortable: false },
    { key: 'memo', label: '메모', hideMobile: true, render: (r) => el('span.truncate', { style: { maxWidth: '220px', display: 'inline-block' } }, r.memo || r.txn.memo || ''), sortable: false },
    { key: 'dec', label: decLabel, align: 'right', render: (r) => (r.amount * sign < 0 ? amountNode(-r.amount * sign) : ''), sortable: false },
    { key: 'inc', label: incLabel, align: 'right', render: (r) => (r.amount * sign > 0 ? amountNode(r.amount * sign) : ''), sortable: false },
    { key: 'rec', label: '상태', mobileLabel: '상태', render: (r) => { const s = store.reconcileStatus(r.txn.id, a.id); return s ? el('span.badge', { title: s === 'R' ? '대조 완료' : '확인 완료', class: s === 'R' ? 'badge-positive' : 'badge-info' }, s, el('span.sr-only', {}, s === 'R' ? ' 대조 완료' : ' 확인 완료')) : ''; }, sortable: false },
    bs ? { key: 'bal', label: '잔액', align: 'right', amount: true, render: (r) => amountNode(r.balance * sign), sortable: false } : null,
  ].filter(Boolean);
  const table = dataTable({
    columns, rows, rowKey: (r) => `${r.txn.id}:${r.postingIdx}`, ariaLabel: `${a.name} 원장`,
    onRowClick: (r) => openTxn(r.txn.id),
    empty: emptyState({ title: '이 기간에 거래가 없습니다', text: '이 계정을 사용하는 거래가 여기에 표시됩니다.' }),
  });
  const newTypes = a.type === 'bank'
    ? [['지출', 'expense'], ['수표', 'check'], ['입금', 'deposit'], ['계좌 이체', 'transfer'], ['분개', 'journal']]
    : a.type === 'creditCard' ? [['지출', 'expense'], ['신용카드 환불', 'ccCredit'], ['신용카드 결제', 'ccPayment'], ['분개', 'journal']]
      : [['분개', 'journal']];
  const draftFor = (type) => {
    if (type === 'deposit' || type === 'expense' || type === 'check' || type === 'ccCredit') return { accountId: a.id };
    if (type === 'transfer') return { fromId: a.id };
    if (type === 'ccPayment') return a.type === 'creditCard' ? { ccAccountId: a.id } : { bankAccountId: a.id };
    return {};
  };
  swap(main, el('div.page', {},
    pageHead({
      title: store.accountName(a.id),
      crumbs: [['계정과목', 'accounts'], [a.name]],
      sub: bs ? el('div.register-balance', {}, el('span.kpi-label', {}, '기말 잔액'), el('span.kpi-value', {}, amountNode(reg.closing * sign))) : null,
      actions: [
        el('a.btn', { href: `#/report/gl?accounts=${a.id}` }, '보고서 실행'),
        a.type === 'bank' || a.type === 'creditCard' ? el('a.btn', { href: `#/reconcile/${a.id}` }, '계좌 대조') : null,
        el('button.btn', { type: 'button', onclick: () => openAccountForm({ account: a }) }, '계정 편집'),
        splitButton('거래 추가', () => openTxnForm({ type: newTypes[0][1], draft: draftFor(newTypes[0][1]) }), newTypes.map(([l, t]) => ({ label: l, onClick: () => openTxnForm({ type: t, draft: draftFor(t) }) }))),
      ].filter(Boolean),
    }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: '메모, 거래처, 번호 검색', label: '원장 검색', onInput: (v) => { st.q = v; renderRegister(main, route); main.querySelector('input[type="search"]')?.focus(); } }),
      selectInput({ options: PERIODS.filter(([k]) => k !== 'custom'), value: st.period, ariaLabel: '기간', onChange: (v) => { st.period = v; renderRegister(main, route); } }),
      [...store.accounts.values()].some((x) => x.parentId === a.id) ? el('label.check', {}, el('input', { type: 'checkbox', checked: st.subs, onchange: (e) => { st.subs = e.target.checked; renderRegister(main, route); } }), '하위 계정 포함') : null,
      el('div.toolbar-end', {}, el('span.muted', {}, `거래 ${rows.length}건`))),
    table.root));
}
