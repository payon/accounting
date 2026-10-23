/**
 * Transaction list pages: All sales, Invoices, Estimates, All purchases
 * transactions, Bills. One configurable view.
 */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable, sortRows } from '../ui/table.js';
import { selectInput } from '../ui/fields.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { amountNode, statusBadge, dateText } from '../ui/format.js';
import { navigate, setQuery } from '../ui/router.js';
import { download } from '../ui/dom.js';
import { pageHead, splitButton, searchBox, emptyState, viewState, menuButton, freshQuery } from './page.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, typeLabel } from '../lib/txn.js';
import { PERIODS, periodRange, today, addDays } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { toCSV } from '../lib/csv.js';
import { openTxnForm, openTxn } from '../forms/index.js';
import { openPayBills } from '../forms/payment.js';
import { printTxn } from '../ui/print.js';
import { convertEstimate } from '../forms/sales.js';

const SALES_TYPES = ['invoice', 'payment', 'estimate', 'salesReceipt', 'creditMemo', 'refundReceipt'];
const EXPENSE_TYPES = ['expense', 'check', 'bill', 'billPayment', 'vendorCredit', 'ccCredit', 'purchaseOrder'];

const PAGES = {
  sales: {
    title: '모든 판매', crumbs: [['판매', 'sales'], ['모든 판매']], types: SALES_TYPES, side: 'sales',
    newLabel: '새 거래', newType: 'invoice',
    newMenu: [['청구서', 'invoice'], ['결제', 'payment'], ['견적서', 'estimate'], ['매출 영수증', 'salesReceipt'], ['대변 메모', 'creditMemo'], ['환불 영수증', 'refundReceipt']],
    statuses: [['all', '모든 상태'], ['open', '진행 중'], ['overdue', '연체'], ['notDue', '기한 전'], ['paid', '결제 완료'], ['pending', '대기 중 견적서']],
  },
  invoices: {
    title: '청구서', crumbs: [['판매', 'sales'], ['청구서']], types: ['invoice'], side: 'sales',
    newLabel: '청구서 만들기', newType: 'invoice', newMenu: [['청구서', 'invoice'], ['결제 기록', 'payment']],
    statuses: [['all', '모든 상태'], ['unpaid', '미수령'], ['overdue', '연체'], ['notDue', '기한 전'], ['partial', '부분 결제'], ['paid', '결제 완료'], ['voided', '파기됨']],
  },
  estimates: {
    title: '견적서', crumbs: [['판매', 'sales'], ['견적서']], types: ['estimate'], side: 'sales',
    newLabel: '견적서 만들기', newType: 'estimate', newMenu: [['견적서', 'estimate']],
    statuses: [['all', '모든 상태'], ['pending', '대기 중'], ['accepted', '승인됨'], ['converted', '전환됨'], ['rejected', '거절됨'], ['closed', '마감됨'], ['expired', '만료됨']],
  },
  expenses: {
    title: '모든 매입', crumbs: [['지출', 'expenses'], ['모든 매입']], types: EXPENSE_TYPES, side: 'purchases',
    newLabel: '새 거래', newType: 'expense',
    newMenu: [['지출', 'expense'], ['수표', 'check'], ['매입채무', 'bill'], ['매입채무 결제', 'pay-bills'], ['발주서', 'purchaseOrder'], ['공급처 대변', 'vendorCredit'], ['신용카드 환불', 'ccCredit']],
    statuses: [['all', '모든 상태'], ['open', '미결 매입채무'], ['overdue', '연체 매입채무'], ['notDue', '기한 전 매입채무'], ['paid', '결제 완료'], ['po', '미결 발주서']],
  },
  bills: {
    title: '매입채무', crumbs: [['지출', 'expenses'], ['매입채무']], types: ['bill'], side: 'purchases',
    newLabel: '매입채무 등록', newType: 'bill', newMenu: [['매입채무', 'bill'], ['매입채무 결제', 'pay-bills'], ['공급처 대변', 'vendorCredit']],
    statuses: [['unpaid', '미결제'], ['overdue', '연체'], ['notDue', '기한 전'], ['paid', '결제 완료'], ['all', '모든 매입채무']],
  },
};

function matchesStatus(t, status) {
  if (status === 'all') return true;
  const s = store.status(t);
  switch (status) {
    case 'open': return ['open', 'overdue', 'partial'].includes(s.code) && (t.type === 'invoice' || t.type === 'bill');
    case 'unpaid': return ['open', 'overdue', 'partial'].includes(s.code);
    case 'overdue': return s.code === 'overdue';
    case 'notDue': return (t.type === 'invoice' || t.type === 'bill') && (s.code === 'open' || s.code === 'partial');
    case 'partial': return s.code === 'partial';
    case 'paid': return s.code === 'paid' || ((t.type === 'payment' || t.type === 'billPayment' || t.type === 'salesReceipt' || t.type === 'expense' || t.type === 'check') && s.code !== 'voided');
    case 'voided': return !!t.voided;
    case 'po': return t.type === 'purchaseOrder' && s.code === 'open';
    default: return s.code === status;
  }
}

function moneyBar(side) {
  const sm = store.summary();
  const now = today();
  const since = addDays(now, -30);
  let paid30 = 0; let paidCount = 0;
  for (const t of store.txns.values()) {
    if (t.voided || t.date < since) continue;
    if (side === 'sales' && (t.type === 'payment' || t.type === 'salesReceipt')) { paid30 += store.total(t); paidCount++; }
    if (side === 'purchases' && (t.type === 'billPayment' || t.type === 'expense' || t.type === 'check')) { paid30 += store.total(t); paidCount++; }
  }
  const open = side === 'sales' ? sm.openInvoices : sm.openBills;
  const overdue = side === 'sales' ? sm.overdueInvoices : sm.overdueBills;
  const notDue = open - overdue;
  const total = Math.max(1, open + paid30);
  const seg = (label, value, count, color, filter) => el('button.money-seg', { type: 'button', onclick: () => filter && setFilter(filter) },
    el('span.money-seg-value', {}, formatMoney(value)),
    el('span.money-seg-label', {}, `${label} ${count}건`),
    el('span.money-seg-bar', { style: { background: `var(${color})`, width: '100%' } }));
  let setFilter = () => {};
  const node = el('div.money-bar', {},
    el('div.money-group', { style: { flex: `${Math.max(open, 1)} 1 0` } },
      el('div.money-group-title', {}, `미결제`),
      el('div.money-segs', {},
        seg(side === 'sales' ? '연체' : '연체', overdue, side === 'sales' ? sm.overdueCount : sm.overdueBillCount, '--negative', 'overdue'),
        seg('기한 전', notDue, (side === 'sales' ? sm.openCount - sm.overdueCount : sm.billCount - sm.overdueBillCount), '--chart-other', 'notDue'))),
    el('div.money-group', { style: { flex: `${Math.max(paid30, 1)} 1 0` } },
      el('div.money-group-title', {}, '결제 완료'),
      el('div.money-segs', {}, seg('최근 30일', paid30, paidCount, '--positive', 'paid'))));
  void total;
  return { node, onFilter(fn) { setFilter = fn; } };
}

export function renderTxnList(main, route) {
  const cfg = PAGES[route.name];
  const st = viewState(`list:${route.name}`, {
    period: route.name === 'bills' ? 'all' : 'last365', status: route.query.status || (route.name === 'bills' ? 'unpaid' : 'all'),
    type: 'all', q: '', sort: { key: 'date', dir: 'desc' }, contact: route.query.contact || null,
  });
  const query = freshQuery(route);
  if (query.status) st.status = query.status;

  const openNewType = (type) => (type === 'pay-bills' ? openPayBills() : openTxnForm({ type }));
  const actions = [
    route.name === 'bills' ? el('button.btn', { type: 'button', onclick: () => openPayBills() }, '매입채무 결제') : null,
    splitButton(cfg.newLabel, () => openNewType(cfg.newType), cfg.newMenu.map(([label, type]) => ({ label, onClick: () => openNewType(type) }))),
  ];

  const now = today();
  const range = periodRange(st.period, { now, fiscalStartMonth: store.settings.fiscalStartMonth });
  const q = st.q.trim().toLowerCase();
  let rows = store.txnList((t) => cfg.types.includes(t.type)
    && (st.type === 'all' || t.type === st.type)
    && (!range.from || t.date >= range.from) && (!range.to || t.date <= range.to)
    && (!st.contact || t.contactId === st.contact));
  rows = rows.filter((t) => matchesStatus(t, st.status));
  if (q) rows = rows.filter((t) => [t.num, store.contactName(t.contactId), t.memo, typeLabel(t.type), formatMoney(store.total(t))].join(' ').toLowerCase().includes(q));

  const isBills = route.name === 'bills';
  const columns = [
    { key: 'date', label: '날짜', width: '110px', render: (t) => dateText(t.date), sortValue: (t) => t.date, defaultDir: 'desc', hideMobile: false },
    cfg.types.length > 1 ? { key: 'type', label: '유형', render: (t) => typeLabel(t.type), sortValue: (t) => typeLabel(t.type) } : null,
    { key: 'num', label: '번호', width: '90px', render: (t) => t.num || '', sortValue: (t) => t.num || '', hideMobile: true },
    { key: 'name', label: cfg.side === 'sales' ? '고객' : '거래처', primary: true, render: (t) => el('span.cell-main', {}, store.contactName(t.contactId) || (t.type === 'transfer' ? '' : '이름 없음')), sortValue: (t) => store.contactName(t.contactId) },
    isBills ? { key: 'due', label: '만기일', render: (t) => dateText(t.dueDate), sortValue: (t) => t.dueDate || '' } : { key: 'memo', label: cfg.side === 'sales' ? '메모' : '카테고리', hideMobile: true, render: (t) => el('span.truncate', { style: { maxWidth: '280px', display: 'inline-block' } }, cfg.side === 'sales' ? t.memo || '' : store.splitName(t) || t.memo || ''), sortable: false },
    { key: 'amount', label: isBills ? '매입채무 금액' : '금액', align: 'right', amount: true, render: (t) => amountNode(store.total(t)), sortValue: (t) => store.total(t) },
    isBills || route.name === 'invoices' ? { key: 'open', label: '미결제 잔액', align: 'right', render: (t) => amountNode(store.openBalance(t.id)), sortValue: (t) => store.openBalance(t.id) } : null,
    { key: 'status', label: '상태', render: (t) => statusBadge(store.status(t)), sortValue: (t) => store.status(t).label },
    { key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false, render: (t) => rowAction(t) },
  ].filter(Boolean);
  rows = sortRows(rows, columns, st.sort);

  let tableApi;
  const selBar = el('div.selection-bar', { hidden: true });
  const onSel = (sel) => {
    selBar.hidden = !sel.size;
    selBar.replaceChildren(
      el('span', {}, `${sel.size}개 선택됨`),
      el('button.btn.btn-sm', { type: 'button', onclick: () => exportRows(rows.filter((t) => sel.has(t.id))) }, '내보내기'),
      el('button.btn.btn-sm', { type: 'button', onclick: () => batchDelete([...sel]) }, '삭제'),
      el('button.btn-link', { type: 'button', onclick: () => tableApi.clearSelection() }, '선택 해제'));
  };

  const periodSel = selectInput({ options: PERIODS.filter(([k]) => k !== 'custom'), value: st.period, ariaLabel: '기간', onChange: (v) => { st.period = v; rerender(); } });
  const statusSel = selectInput({ options: cfg.statuses, value: st.status, ariaLabel: '상태', onChange: (v) => { st.status = v; setQuery({ status: null }); rerender(); } });
  const typeSel = cfg.types.length > 1 ? selectInput({ options: [['all', '모든 거래'], ...cfg.types.map((t) => [t, TXN_TYPES[t].plural])], value: st.type, ariaLabel: '유형', onChange: (v) => { st.type = v; rerender(); } }) : null;
  const search = searchBox({ value: st.q, placeholder: '번호, 이름, 금액으로 검색', label: `${cfg.title} 검색`, onInput: (v) => { st.q = v; rerender(true); } });

  const bar = moneyBar(cfg.side);
  bar.onFilter((f) => { st.status = cfg.statuses.some((s) => s[0] === f) ? f : 'all'; rerender(); });

  tableApi = dataTable({
    columns, rows, ariaLabel: cfg.title,
    selectable: true, onSelectionChange: onSel,
    sort: st.sort, onSort: (s) => { st.sort = s; rerender(); },
    onRowClick: (t) => openTxn(t.id),
    empty: emptyState({ iconName: cfg.side === 'sales' ? 'invoice' : 'receipt', title: '아직 내용이 없습니다', text: q || st.status !== 'all' ? '조건에 맞는 거래가 없습니다.' : `첫 ${TXN_TYPES[cfg.newType].label}을(를) 만들면 여기에 표시됩니다.` }),
    footer: (data) => columns.map((c, i) => (i === 0 ? `거래 ${data.length}건` : c.key === 'amount' ? formatMoney(data.reduce((s, t) => s + store.total(t), 0)) : c.key === 'open' ? formatMoney(data.reduce((s, t) => s + store.openBalance(t.id), 0)) : '')),
  });

  const contactChip = st.contact ? el('button.chip', { type: 'button', 'aria-pressed': 'true', onclick: () => { st.contact = null; setQuery({ contact: null }); rerender(); } }, store.contactName(st.contact), el('span', { html: icon('x', 14) }), el('span.sr-only', {}, '필터 제거')) : null;

  swap(main, el('div.page', {},
    pageHead({ title: cfg.title, crumbs: cfg.crumbs, actions }),
    cfg.types.length > 1 || isBills || route.name === 'invoices' ? bar.node : null,
    el('div.toolbar', {}, search, typeSel, statusSel, periodSel, contactChip,
      el('div.toolbar-end', {},
        el('button.icon-btn', { type: 'button', 'aria-label': 'CSV로 내보내기', title: 'CSV로 내보내기', html: icon('download', 18), onclick: () => exportRows(rows) }),
        el('button.icon-btn', { type: 'button', 'aria-label': '목록 인쇄', title: '목록 인쇄', html: icon('printer', 18), onclick: () => window.print() }))),
    selBar,
    tableApi.root));

  function rerender(keepFocus) {
    const active = keepFocus ? document.activeElement : null;
    const pos = active?.selectionStart;
    renderTxnList(main, { ...route, query: {} });
    if (active?.type === 'search') {
      const again = main.querySelector('input[type="search"]');
      again?.focus();
      if (pos !== undefined) again?.setSelectionRange(pos, pos);
    }
  }
}

function rowAction(t) {
  const s = store.status(t);
  if (t.type === 'invoice' && ['open', 'overdue', 'partial'].includes(s.code)) {
    return el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'payment', draft: { contactId: t.contactId, preselect: t.id } }) }, '결제 기록');
  }
  if (t.type === 'bill' && ['open', 'overdue', 'partial'].includes(s.code)) {
    return el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'billPayment', draft: { contactId: t.contactId, preselect: t.id } }) }, '결제 처리');
  }
  if (t.type === 'estimate' && (t.status || 'pending') === 'pending') {
    return el('button.row-link', { type: 'button', onclick: () => convertEstimate(t) }, '청구서로 전환');
  }
  if (['invoice', 'salesReceipt', 'estimate', 'creditMemo', 'refundReceipt'].includes(t.type)) {
    return el('button.row-link', { type: 'button', onclick: () => printTxn(t) }, '인쇄');
  }
  return el('button.row-link', { type: 'button', onclick: () => openTxn(t.id) }, '보기/편집');
}

function exportRows(rows) {
  const data = [['날짜', '유형', '번호', '이름', '메모', '금액', '미결제 잔액', '상태'],
    ...rows.map((t) => [t.date, typeLabel(t.type), t.num || '', store.contactName(t.contactId), t.memo || '', (store.total(t) / 100).toFixed(2), ['invoice', 'bill'].includes(t.type) ? (store.openBalance(t.id) / 100).toFixed(2) : '', store.status(t).label])];
  download(toCSV(data), `transactions-${today()}.csv`, 'text/csv');
}

async function batchDelete(ids) {
  const ok = await confirmDialog({ title: `거래 ${ids.length}건을 삭제하시겠습니까?`, message: '장부에서 제거되며 이 작업은 되돌릴 수 없습니다.', confirmLabel: '삭제', danger: true });
  if (!ok) return;
  let n = 0;
  for (const id of ids) {
    try { store.deleteTxn(id); n++; } catch (err) { toastError(err); break; }
  }
  toast(`${n}건 삭제했습니다`);
}

export const TXN_LIST_ROUTES = Object.keys(PAGES);
export { navigate };
