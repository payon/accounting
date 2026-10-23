/** Reconcile: start (pick account, statement date and balance), then tick off transactions. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field, moneyInput, dateInput, selectInput } from '../ui/fields.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { pageHead, emptyState, viewState, tabs, pageDraft } from './page.js';
import { openTxn } from '../forms/index.js';
import { store } from '../lib/store.js';
import { typeLabel } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { formatDate, today, endOfMonth, addMonths } from '../lib/dates.js';
import { typeInfo } from '../lib/accounts.js';
import { candidates, summarize, finishRecord, lastReconciliation, draftReconciliation, beginningBalance, undoLast } from '../lib/reconcile.js';

export function renderReconcile(main, route) {
  const accounts = store.accountsOfType('bank', 'creditCard', 'otherCurrentAsset');
  const accountId = route.params[0];
  if (!accountId) return renderStart(main, route, accounts);
  const account = store.account(accountId);
  if (!account) return renderStart(main, route, accounts);
  const draft = draftReconciliation(store, accountId);
  if (!draft) return renderStart(main, route, accounts, accountId);
  return renderSession(main, account, draft);
}

function renderStart(main, route, accounts, preselect = null) {
  // What the user has entered so far survives a re-render (a change synced
  // from another tab or device) for as long as they stay on this page.
  const form = pageDraft(route, 'reconcileStart', () => {
    const accountId = preselect || accounts[0]?.id || null;
    const l = accountId ? lastReconciliation(store, accountId) : null;
    return { accountId, statementDate: l ? endOfMonth(addMonths(l.statementDate, 1)) : endOfMonth(addMonths(today(), -1)), ending: null };
  });
  let { accountId, statementDate, ending } = form;
  const last = () => (accountId ? lastReconciliation(store, accountId) : null);
  const sel = selectInput({ options: accounts.map((a) => [a.id, a.name]), value: accountId, ariaLabel: '계정', onChange: (v) => { accountId = form.accountId = v; paintInfo(); } });
  const date = dateInput({ value: statementDate, ariaLabel: '기준일', onChange: (v) => { statementDate = form.statementDate = v; } });
  const end = moneyInput({ value: ending, allowNegative: true, ariaLabel: '기말 잔액', onChange: (v) => { ending = form.ending = v; } });
  const info = el('div.keyval');
  function paintInfo() {
    const l = last();
    const sign = typeInfo(store.account(accountId)?.type).sign;
    info.replaceChildren(
      el('dt', {}, '기초 잔액'), el('dd', {}, formatMoney(beginningBalance(store, accountId) * sign)),
      el('dt', {}, '이전 내역서 기준일'), el('dd', {}, l ? formatDate(l.statementDate) : '대조하지 않음'));
  }
  if (accountId) paintInfo();
  const history = [...store.recons.values()].filter((r) => r.status === 'done').sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  swap(main, el('div.page', {},
    pageHead({ title: '계좌 대조', crumbs: [['Payon', 'banking'], ['계좌 대조']], actions: [el('a.btn', { href: '#/report/reconDiscrepancy' }, '대조 후 변경 내역')] }),
    !accounts.length ? emptyState({ iconName: 'scale', title: '대조할 계정이 없습니다', text: '먼저 은행 또는 신용카드 계정을 추가하세요.' }) : el('div.recon-start', {},
      el('div.card', {}, el('div.card-body.stack', {},
        el('h2', { style: { fontSize: '17px' } }, '어떤 계정을 대조하시겠습니까?'),
        field('계정', sel),
        info,
        el('h2', { style: { fontSize: '17px', marginTop: '8px' } }, '다음 정보를 입력하세요'),
        el('p.field-hint', {}, '은행 또는 카드 내역서의 기준일과 기말 잔액을 입력하세요.'),
        el('div.form-grid', {}, field('기말 잔액', end, { required: true }), field('기준일', date, { required: true })),
        el('div', {}, el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => {
            if (ending === null || ending === undefined) { toast('내역서 기말 잔액을 입력하세요.'); end.input.focus(); return; }
            const existing = draftReconciliation(store, accountId);
            store.put('recons', { ...(existing || {}), accountId, statementDate, endingBalance: ending, status: 'draft', clearedIds: existing?.clearedIds || autoTick(accountId, statementDate) });
            navigate(`reconcile/${accountId}`);
          },
        }, '대조 시작')))),
      history.length ? el('div.card', {}, el('div.card-head', {}, el('h2.card-title', {}, '대조 이력')), el('div.card-body', {},
        el('table.grid', {},
          el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '계정'), el('th', { scope: 'col' }, '내역서 기준일'), el('th.num', { scope: 'col' }, '기말 잔액'), el('th.num', { scope: 'col' }, '차액 조정'), el('th', { scope: 'col' }, el('span.sr-only', {}, '작업')))),
          el('tbody', {}, history.slice(0, 20).map((r) => el('tr', {},
            el('td', {}, store.account(r.accountId)?.name || ''),
            el('td', {}, formatDate(r.statementDate)),
            el('td.num', {}, formatMoney(r.endingBalance)),
            el('td.num', {}, r.adjustmentId ? formatMoney(store.total(store.txn(r.adjustmentId) || {}) || 0) : ''),
            el('td.actions-cell', {}, lastReconciliation(store, r.accountId)?.id === r.id ? el('button.row-link', { type: 'button', onclick: async () => {
              if (await confirmDialog({ title: '이 대조를 되돌리시겠습니까?', message: '이 대조의 거래는 다시 미대조 상태가 됩니다. 내역서를 잘못 대조했을 때 사용하세요.', confirmLabel: '되돌리기', danger: true })) { undoLast(store, r.accountId); toast('대조를 되돌렸습니다'); }
            } }, '되돌리기') : null))))))) : null)));
}

/** Pre-tick what the bank feed already cleared, up to the statement date. */
function autoTick(accountId, statementDate) {
  return candidates(store, accountId, statementDate).filter((c) => c.cleared).map((c) => c.txn.id);
}

function plural(n, word) {
  return `${word} ${n}건`;
}

function renderSession(main, account, draft) {
  const st = viewState(`recon:${draft.id}`, { tab: 'all' });
  const selected = new Set(draft.clearedIds || []);
  const items = candidates(store, account.id, draft.statementDate);
  const sign = typeInfo(account.type).sign;
  const card = account.type === 'creditCard';
  const sum = summarize(store, account.id, { endingBalance: draft.endingBalance, selected, items });
  const save = () => store.put('recons', { ...draft, clearedIds: [...selected] }, { silent: true });

  const header = el('div.recon-summary', {},
    el('div.recon-figure', {}, el('div.kpi-label', {}, '내역서 기말 잔액'), el('div.kpi-value', {}, formatMoney(sum.ending))),
    el('div.recon-op', { 'aria-hidden': 'true' }, '-'),
    el('div.recon-figure', {}, el('div.kpi-label', {}, '확인된 잔액'), el('div.kpi-value', {}, formatMoney(sum.cleared)),
      el('div.cell-sub', {}, `기초 ${formatMoney(sum.beginning)} + ${plural(sum.nIn, card ? '사용 금액' : '입금')} ${formatMoney(sum.increases)} - ${plural(sum.nOut, '결제')} ${formatMoney(sum.decreases)}`)),
    el('div.recon-op', { 'aria-hidden': 'true' }, '='),
    el('div.recon-figure', { role: 'status', 'aria-live': 'polite' }, el('div.kpi-label', {}, '차액'), el(`div.kpi-value${sum.difference ? '.neg' : ''}`, {}, formatMoney(sum.difference)), sum.difference === 0 ? el('div.cell-sub', { style: { color: 'var(--positive)' } }, el('span', { html: icon('ok', 13) }), ' 잔액이 일치합니다') : null));

  let list = items;
  if (st.tab === 'in') list = items.filter((c) => c.amount * sign > 0);
  if (st.tab === 'out') list = items.filter((c) => c.amount * sign < 0);
  const table = el('table.grid', { 'aria-label': '대조할 거래' });
  const allBox = el('input', { type: 'checkbox', 'aria-label': '전체 선택' });
  allBox.checked = list.length > 0 && list.every((c) => selected.has(c.txn.id));
  allBox.addEventListener('change', () => { for (const c of list) if (allBox.checked) selected.add(c.txn.id); else selected.delete(c.txn.id); save(); rerender(); });
  table.append(el('thead', {}, el('tr', {},
    el('th', { scope: 'col' }, '날짜'), el('th', { scope: 'col' }, '확인 날짜'), el('th', { scope: 'col' }, '유형'), el('th', { scope: 'col' }, '참조번호'), el('th', { scope: 'col' }, '거래처'), el('th', { scope: 'col' }, '메모'),
    el('th.num', { scope: 'col' }, card ? '사용 금액' : '결제'), el('th.num', { scope: 'col' }, card ? '결제' : '입금'), el('th.check-cell', { scope: 'col' }, allBox))));
  const tb = el('tbody');
  for (const c of list) {
    const on = selected.has(c.txn.id);
    const cb = el('input', { type: 'checkbox', checked: on, 'aria-label': `${formatDate(c.txn.date)} ${typeLabel(c.txn.type)} ${formatMoney(Math.abs(c.amount))} 확인 처리` });
    cb.addEventListener('change', () => { if (cb.checked) selected.add(c.txn.id); else selected.delete(c.txn.id); save(); rerender(); });
    const natural = c.amount * sign;
    const tr = el('tr.clickable', { class: on ? 'is-selected' : '' },
      el('td', {}, dateText(c.txn.date)), el('td', {}, c.cleared ? '은행 피드' : ''), el('td', {}, el('button.row-link', { type: 'button', onclick: () => openTxn(c.txn.id) }, typeLabel(c.txn.type))), el('td', {}, c.txn.num || c.txn.ref || ''),
      el('td', {}, store.contactName(c.txn.contactId)), el('td', {}, el('span.truncate', { style: { maxWidth: '220px', display: 'inline-block' } }, c.txn.memo || '')),
      el('td.num', {}, card ? (natural > 0 ? amountNode(natural) : '') : (natural < 0 ? amountNode(-natural) : '')),
      el('td.num', {}, card ? (natural < 0 ? amountNode(-natural) : '') : (natural > 0 ? amountNode(natural) : '')),
      el('td.check-cell', {}, cb));
    tr.addEventListener('click', (e) => { if (!e.target.closest('button, input')) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
    tb.append(tr);
  }
  table.append(tb);

  const finish = async () => {
    let adjustmentId = null;
    if (sum.difference !== 0) {
      const ok = await confirmDialog({ title: '장부와 내역서가 일치하지 않습니다', message: `차액이 ${formatMoney(sum.difference)}입니다. 계속 확인하거나, 계좌 대조 차액 조정 항목을 추가해 장부를 맞출 수 있습니다.`, confirmLabel: '조정 추가 후 마무리', cancelLabel: '계속 확인' });
      if (!ok) return;
      const diffDebit = sum.difference * sign; // natural -> debit sign
      const disc = store.roleAccount('reconDiscrepancy');
      const adj = store.saveTxn({ type: 'journal', date: draft.statementDate, num: store.nextNumber('journal'), memo: `${account.name} 대조 차액 조정`, lines: [
        { accountId: account.id, debit: Math.max(diffDebit, 0), credit: Math.max(-diffDebit, 0), desc: '계좌 대조 차액 조정' },
        { accountId: disc, debit: Math.max(-diffDebit, 0), credit: Math.max(diffDebit, 0), desc: '계좌 대조 차액 조정' },
      ] }, { allowLocked: true });
      adjustmentId = adj.id;
      selected.add(adj.id);
    }
    const rec = finishRecord(store, { accountId: account.id, statementDate: draft.statementDate, endingBalance: draft.endingBalance, selected, draftId: draft.id, adjustmentId });
    store.put('recons', rec);
    toast(`${account.name} 계정을 ${formatDate(draft.statementDate)}까지 대조했습니다`);
    navigate('reconcile');
  };

  function rerender() { renderSession(main, account, store.recons.get(draft.id) || draft); }

  swap(main, el('div.page', {},
    pageHead({
      title: `${account.name} 계좌 대조`,
      crumbs: [['계좌 대조', 'reconcile'], [account.name]],
      sub: el('span.muted', {}, `내역서 기준일 ${formatDate(draft.statementDate)}`),
      actions: [
        el('button.btn', { type: 'button', onclick: () => { store.put('recons', { ...draft, status: 'draft' }); toast('나중에 하도록 저장했습니다'); navigate('reconcile'); } }, '저장 후 나중에'),
        el('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog({ title: '대조를 중단하시겠습니까?', message: '이 내역서에 표시한 체크가 모두 버려집니다.', confirmLabel: '버리기', danger: true })) { store.remove('recons', draft.id); navigate('reconcile'); } } }, '취소'),
        el('button.btn.btn-primary', { type: 'button', onclick: finish }, '지금 마무리'),
      ],
    }),
    header,
    tabs([['all', '전체', items.length], ['out', '결제', items.filter((c) => c.amount * sign < 0).length], ['in', card ? '사용 금액' : '입금', items.filter((c) => c.amount * sign > 0).length]], st.tab, (k) => { st.tab = k; rerender(); }, { label: '거래 필터' }),
    items.length ? el('div.table-wrap', {}, el('div.table-scroll', {}, table)) : emptyState({ iconName: 'ok', title: '대조할 항목이 없습니다', text: '기준일까지의 모든 거래는 이미 대조되었습니다.' })));
}
