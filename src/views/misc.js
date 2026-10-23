/** Recurring transactions, sales tax, and the audit log. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable } from '../ui/table.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, moneyInput } from '../ui/fields.js';
import { openMenu } from '../ui/menu.js';
import { navigate } from '../ui/router.js';
import { pageHead, emptyState, viewState, tabs } from './page.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, typeLabel, txnTotal } from '../lib/txn.js';
import { describeSchedule, dueDates } from '../lib/recurring.js';
import { formatMoney } from '../lib/money.js';
import { today, periodRange, formatRange } from '../lib/dates.js';
import { salesTaxLiability } from '../lib/reports.js';
import { openRecurringForm } from '../forms/recurring.js';
import { openTxnForm, openTxn } from '../forms/index.js';
import { createFromTemplate, runRecurring } from '../lib/recurring-run.js';

// --------------------------------------------------------------- recurring

export function renderRecurring(main) {
  const rows = [...store.recurring.values()].sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));
  const now = today();
  const columns = [
    { key: 'name', label: '템플릿 이름', primary: true, render: (r) => el('span.cell-main', {}, r.name), sortable: false },
    { key: 'type', label: '유형', render: (r) => typeLabel(r.type), sortable: false },
    { key: 'mode', label: '실행 방식', hideMobile: true, render: (r) => (r.mode === 'reminder' ? '알림' : '예약'), sortable: false },
    { key: 'interval', label: '주기', hideMobile: true, render: (r) => describeSchedule(r), sortable: false },
    { key: 'prev', label: '이전 실행일', hideMobile: true, render: (r) => dateText(r.lastCreated), sortable: false },
    { key: 'next', label: '다음 실행일', render: (r) => (r.active === false ? el('span.badge', {}, '일시 중지') : el('span', {}, dateText(r.nextDate), dueDates(r, now, 1).length ? el('span.badge.badge-warning', { style: { marginLeft: '8px' } }, '기한 도래') : null)), sortable: false },
    { key: 'name2', label: '고객 또는 공급처', hideMobile: true, render: (r) => store.contactName(r.template?.contactId), sortable: false },
    { key: 'amount', label: '금액', align: 'right', amount: true, render: (r) => amountNode(txnTotal(r.template || {}, store.ctx())), sortable: false },
    {
      key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false,
      render: (r) => {
        const b = el('button.btn.btn-sm', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, '사용', el('span', { html: icon('chevDown', 14) }));
        b.addEventListener('click', () => openMenu(b, [
          { label: '지금 사용', icon: 'plus', onClick: () => openTxnForm({ type: r.type, draft: { ...structuredClone(r.template), date: today() } }) },
          { label: '지금 일정대로 생성', icon: 'repeat', disabled: !dueDates(r, now, 1).length, onClick: () => { const n = runRecurring(store, { only: r.id, includeReminders: true }); toast(`${n}건 생성됨`); } },
          { label: '일정 편집', icon: 'pencil', onClick: () => openRecurringForm({ rule: r }) },
          { label: r.active === false ? '재개' : '일시 중지', icon: r.active === false ? 'repeat' : 'ban', onClick: () => store.put('recurring', { ...r, active: r.active === false }) },
          { label: '복제', icon: 'copy', onClick: () => store.put('recurring', { ...structuredClone(r), id: undefined, name: `${r.name} (사본)`, count: 0 }) },
          'sep',
          { label: '삭제', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `${r.name}을(를) 삭제하시겠습니까?`, message: '이 템플릿으로 이미 생성된 거래는 그대로 유지됩니다.', confirmLabel: '삭제', danger: true })) store.remove('recurring', r.id); } },
        ], { align: 'end' }));
        return b;
      },
    },
  ];
  const table = dataTable({
    columns, rows, ariaLabel: '반복 거래',
    onRowClick: (r) => openRecurringForm({ rule: r }),
    empty: emptyState({ iconName: 'repeat', title: '반복 거래가 없습니다', text: '청구서, 매입채무, 지출 또는 분개를 열어 하단의 "반복 거래로 등록"을 선택하면 일정으로 저장됩니다.' }),
  });
  swap(main, el('div.page', {},
    pageHead({ title: '반복 거래', crumbs: [['반복 거래']], actions: [el('button.btn.btn-primary', { type: 'button', onclick: () => newTemplate() }, '새로 만들기')] }),
    table.root));
}

function newTemplate() {
  const types = ['invoice', 'bill', 'expense', 'check', 'deposit', 'transfer', 'journal', 'salesReceipt'];
  const pick = el('div.stack', {}, el('p', {}, '어떤 종류의 거래를 반복할까요? 내용을 채운 뒤 하단에서 "반복 거래로 등록"을 선택하세요.'),
    el('div.chip-row', { style: { flexWrap: 'wrap' } }, types.map((t) => el('button.chip', { type: 'button', onclick: () => { dlg.close(); openTxnForm({ type: t }); } }, TXN_TYPES[t].label))));
  const dlg = openDialog({ title: '새 반복 거래 템플릿', body: pick });
}

// --------------------------------------------------------------- sales tax

export function renderSalesTax(main) {
  const st = viewState('salestax', { period: 'lastQuarter' });
  const range = periodRange(st.period, { now: today(), fiscalStartMonth: store.settings.fiscalStartMonth });
  const rep = salesTaxLiability(store, range);
  const liability = store.accountBalance(store.roleAccount('salesTax'));
  const rates = store.taxRateList({ includeInactive: true });
  const columns = [
    { key: 'name', label: '세율 이름', primary: true, render: (r) => el('span.cell-main', {}, r.name, r.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, '비활성') : null), sortable: false },
    { key: 'agency', label: '기관', render: (r) => r.agency || '', sortable: false },
    { key: 'rate', label: '세율', align: 'right', render: (r) => `${(r.rate / 100).toFixed(r.rate % 100 ? 2 : 0)}%`, sortable: false },
    { key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false, render: (r) => el('button.row-link', { type: 'button', onclick: () => editRate(r) }, '편집') },
  ];
  const periodSel = el('select.select', { 'aria-label': '기간', onchange: (e) => { st.period = e.target.value; renderSalesTax(main); } },
    [['thisMonth', '이번 달'], ['lastMonth', '지난달'], ['thisQuarter', '이번 분기'], ['lastQuarter', '지난 분기'], ['thisYear', '올해'], ['lastYear', '지난해']].map(([v, l]) => el('option', { value: v, selected: st.period === v }, l)));
  const totalTax = rep.rows.at(-1).values[3];
  swap(main, el('div.page', {},
    pageHead({ title: '부가가치세', crumbs: [['부가가치세', 'sales-tax'], ['부가가치세']], actions: [el('a.btn', { href: '#/report/salesTax' }, '납부 예정 보고서'), el('button.btn', { type: 'button', onclick: () => editRate(null) }, '세율 추가'), el('button.btn.btn-primary', { type: 'button', onclick: () => recordPayment(liability) }, '세금 납부 기록')] }),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.kpi-label', {}, '현재 납부할 부가가치세'), el('div.kpi-value', {}, formatMoney(liability))),
      el('div.stat', {}, el('div.kpi-label', {}, `${formatRange(range.from, range.to)} 부과된 세액`), el('div.kpi-value', {}, formatMoney(totalTax)), el('div.field', { style: { marginTop: '6px' } }, periodSel))),
    el('h2.section-title', {}, '세율'),
    dataTable({ columns, rows: rates, ariaLabel: '부가가치세 세율', onRowClick: (r) => editRate(r), empty: emptyState({ iconName: 'percent', title: '세율이 없습니다', text: '부과하는 부가가치세 세율을 추가하세요.' }) }).root));
}

function editRate(rate) {
  const r = rate ? structuredClone(rate) : { name: '', rate: 0, agency: '', active: true };
  const name = textInput({ value: r.name });
  name.addEventListener('input', () => { r.name = name.value; });
  const agency = textInput({ value: r.agency || '' });
  agency.addEventListener('input', () => { r.agency = agency.value; });
  const pct = textInput({ value: r.rate ? String(r.rate / 100) : '', inputMode: 'decimal' });
  pct.addEventListener('input', () => { r.rate = Math.round((parseFloat(pct.value) || 0) * 100); });
  const active = el('label.check', {}, el('input', { type: 'checkbox', checked: r.active !== false, onchange: (e) => { r.active = e.target.checked; } }), '활성');
  const dlg = openDialog({
    title: rate ? '세율 편집' : '세율 추가',
    body: el('div.stack', {}, field('이름', name, { required: true }), el('div.form-grid', {}, field('세율 (%)', pct, { hint: '예: 8.25' }), field('기관', agency)), active),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', { type: 'button', onclick: () => { if (!r.name.trim()) { name.focus(); return; } store.put('taxRates', r); toast('세율이 저장되었습니다'); dlg.close(); } }, '저장')),
    initialFocus: name,
  });
}

function recordPayment(owed) {
  let amount = owed;
  const bank = store.accountsOfType('bank')[0]?.id;
  const amt = moneyInput({ value: owed, ariaLabel: '납부 금액', onChange: (v) => { amount = v || 0; } });
  const dlg = openDialog({
    title: '부가가치세 납부 기록',
    body: el('div.stack', {}, el('p', {}, `현재 ${formatMoney(owed)}을(를) 납부해야 합니다. 세무 기관에 납부한 금액을 기록하세요. 미지급 부가가치세가 줄고 은행 계좌에서 차감됩니다.`), field('납부 금액', amt)),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', {
      type: 'button',
      onclick: () => {
        dlg.close();
        openTxnForm({ type: 'expense', draft: { accountId: bank, memo: '부가가치세 납부', lines: [{ accountId: store.roleAccount('salesTax'), amount, desc: '부가가치세 납부' }] } });
      },
    }, '계속')),
  });
}

// --------------------------------------------------------------- audit log

export function renderAudit(main) {
  const st = viewState('audit', { kind: 'all' });
  const items = [];
  const label = { txns: '거래', contacts: '거래처', items: '품목', accounts: '계정', rules: '규칙', recurring: '반복 거래 템플릿', taxRates: '세율', recons: '계좌 대조' };
  for (const [col, name] of Object.entries(label)) {
    if (st.kind !== 'all' && st.kind !== col) continue;
    for (const r of store[col].values()) {
      const what = col === 'txns' ? `${typeLabel(r.type)}${r.num ? ` #${r.num}` : ''}${r.contactId ? `, ${store.contactName(r.contactId)}` : ''}`
        : col === 'contacts' ? r.displayName : col === 'accounts' ? store.accountName(r.id) : col === 'recons' ? `${store.account(r.accountId)?.name || ''} ${r.statementDate}까지` : r.name;
      items.push({ id: `${col}:${r.id}`, col, name, what, at: r.updatedAt || r.createdAt || 0, created: (r.updatedAt || 0) - (r.createdAt || 0) < 1000, rec: r });
    }
  }
  items.sort((a, b) => b.at - a.at);
  const rows = items.slice(0, 2000);
  const columns = [
    { key: 'at', label: '변경 날짜', render: (r) => (r.at ? new Date(r.at).toLocaleString() : ''), sortable: false },
    { key: 'event', label: '이벤트', render: (r) => (r.created ? '추가' : '수정'), sortable: false },
    { key: 'name', label: '유형', render: (r) => r.name, sortable: false },
    { key: 'what', label: '이름', primary: true, render: (r) => el('span.cell-main', {}, r.what || ''), sortable: false },
    { key: 'amount', label: '금액', align: 'right', render: (r) => (r.col === 'txns' ? amountNode(store.total(r.rec)) : ''), sortable: false },
  ];
  swap(main, el('div.page', {},
    pageHead({ title: '감사 기록', crumbs: [['감사 기록']] }),
    tabs([['all', '전체'], ['txns', '거래'], ['contacts', '거래처'], ['accounts', '계정'], ['items', '품목']], st.kind, (k) => { st.kind = k; renderAudit(main); }, { label: '필터' }),
    el('p.field-hint', { style: { marginBottom: '10px' } }, '장부의 최근 변경 내역이며 최신 항목이 먼저 표시됩니다. 삭제된 기록은 나열되지 않습니다.'),
    dataTable({
      columns, rows, ariaLabel: '감사 기록',
      onRowClick: (r) => {
        if (r.col === 'txns') openTxn(r.rec.id);
        else if (r.col === 'contacts') navigate(`${r.rec.kind}/${r.rec.id}`);
        else if (r.col === 'accounts') navigate(`register/${r.rec.id}`);
      },
      empty: emptyState({ iconName: 'history', title: '변경 내역이 없습니다' }),
    }).root));
}

export { createFromTemplate };
