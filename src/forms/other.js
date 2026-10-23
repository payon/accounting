/** Deposit, transfer, credit card payment, and journal entry. */
import { el, clear } from '../ui/dom.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { openFrame } from './frame.js';
import { contactPicker, accountPicker, lineGrid, filledLines, attachmentsBlock, headline, recentMenu } from './common.js';
import { store } from '../lib/store.js';
import { newId } from '../lib/ids.js';
import { TXN_TYPES, PAYMENT_METHODS } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today, formatDate } from '../lib/dates.js';
import { txnMoreActions } from './actions.js';
import { openRecurringFromTxn } from './recurring.js';

const ANY_ACCOUNT = null;

// ---------------------------------------------------------------- deposit

export function openDepositForm({ id = null, draft = null, onSaved = null } = {}) {
  const existing = id ? store.txn(id) : null;
  const doc = existing ? structuredClone(existing) : {
    id: newId(), type: 'deposit', date: today(), accountId: store.accountsOfType('bank')[0]?.id || null, lines: [], memo: '', attachments: [], ...(draft || {}),
  };
  if (!doc.id) doc.id = newId();
  const paymentLines = (doc.lines || []).filter((l) => l.paymentId);
  const otherLines = (doc.lines || []).filter((l) => !l.paymentId).map((l) => ({ ...l }));
  // Only payments still waiting for this deposit can be in it, at what they
  // are now: a duplicated deposit must not deposit its payments again, and a
  // payment voided or changed since is dropped or updated.
  const waiting = new Map(store.undepositedItems(existing?.id).map((t) => [t.id, t]));
  const selected = new Map();
  let stale = false;
  for (const l of paymentLines) {
    const t = waiting.get(l.paymentId);
    if (!t) { stale = true; continue; }
    const amount = store.total(t);
    if (amount !== l.amount) stale = true;
    selected.set(l.paymentId, { ...l, amount });
  }
  let dirty = !!draft || stale;
  const touch = () => { dirty = true; };
  const head = headline('금액');

  const acct = accountPicker({ value: doc.accountId, types: ['bank', 'otherCurrentAsset'], ariaLabel: '입금 계정', onChange: (v) => { doc.accountId = v; touch(); } });
  const date = dateInput({ value: doc.date, ariaLabel: '날짜', required: true, onChange: (v) => { doc.date = v; touch(); } });

  // Undeposited payments
  const pendingBox = el('div');
  function paintPending() {
    clear(pendingBox);
    const items = store.undepositedItems(existing?.id);
    if (!items.length) {
      pendingBox.append(el('p.field-hint', {}, '미입금 수납으로 대기 중인 영수가 없습니다.'));
      return;
    }
    const table = el('table.grid.apply-table', { 'aria-label': '입금 대기 중인 영수' });
    table.append(el('thead', {}, el('tr', {},
      el('th.check-cell', { scope: 'col' }, el('span.sr-only', {}, '포함')),
      el('th', { scope: 'col' }, '수취인'), el('th', { scope: 'col' }, '날짜'), el('th', { scope: 'col' }, '유형'), el('th', { scope: 'col' }, '지불 수단'), el('th.num', { scope: 'col' }, '금액'))));
    const tb = el('tbody');
    for (const t of items) {
      const amt = store.total(t);
      const cb = el('input', { type: 'checkbox', checked: selected.has(t.id), 'aria-label': `${formatDate(t.date)}에 ${store.contactName(t.contactId)}의 영수 포함` });
      cb.addEventListener('change', () => {
        if (cb.checked) selected.set(t.id, { paymentId: t.id, contactId: t.contactId, amount: amt, desc: `${TXN_TYPES[t.type].label}${t.ref ? ` ${t.ref}` : ''}` });
        else selected.delete(t.id);
        touch();
        refresh();
      });
      tb.append(el('tr', {}, el('td.check-cell', {}, cb), el('td', {}, store.contactName(t.contactId)), el('td', {}, formatDate(t.date)), el('td', {}, TXN_TYPES[t.type].label), el('td', {}, t.paymentMethod || ''), el('td.num', {}, formatMoney(amt))));
    }
    table.append(tb);
    pendingBox.append(el('div.table-wrap', {}, el('div.table-scroll', {}, table)));
  }
  paintPending();

  const makeLine = () => ({ contactId: null, accountId: null, desc: '', method: '', ref: '', amount: 0 });
  const grid = lineGrid({
    ariaLabel: '입금액에 다른 자금 추가',
    lines: otherLines,
    makeLine,
    onChange: () => { touch(); refresh(); },
    columns: [
      { key: 'from', label: '수취인', width: '20%', cell: (line, row) => contactPicker({ kind: 'any', value: line.contactId, ariaLabel: `수취인, ${row.index + 1}행`, onChange: (v) => { line.contactId = v; row.changed(); } }).root },
      { key: 'acct', label: '계정과목', width: '24%', cell: (line, row) => accountPicker({ value: line.accountId, types: ANY_ACCOUNT, ariaLabel: `계정과목, ${row.index + 1}행`, onChange: (v) => { line.accountId = v; row.changed(); } }).root },
      { key: 'desc', label: '설명', cell: (line, row) => { const i = textInput({ value: line.desc || '', ariaLabel: `설명, ${row.index + 1}행` }); i.addEventListener('input', () => { line.desc = i.value; row.changed(); }); return i; } },
      { key: 'method', label: '지불 수단', width: '14%', cell: (line, row) => selectInput({ options: [['', ''], ...PAYMENT_METHODS.map((m) => [m, m])], value: line.method || '', ariaLabel: `지불 수단, ${row.index + 1}행`, onChange: (v) => { line.method = v; row.changed(); } }) },
      { key: 'amount', label: '금액', width: '130px', align: 'right', cell: (line, row) => moneyInput({ value: line.amount || null, allowNegative: true, ariaLabel: `금액, ${row.index + 1}행`, onChange: (v) => { line.amount = v || 0; row.changed(); } }).root },
    ],
  });

  const cashBackAcct = accountPicker({ value: doc.cashBackAccountId || null, types: ['bank', 'otherCurrentAsset', 'expense', 'equity'], ariaLabel: '현금 인출 대상 계정', onChange: (v) => { doc.cashBackAccountId = v; touch(); } });
  const cashBack = moneyInput({ value: doc.cashBack || null, ariaLabel: '현금 인출액', onChange: (v) => { doc.cashBack = v || 0; touch(); refresh(); } });
  const totals = el('dl.doc-totals');
  function refresh() {
    const sumSel = [...selected.values()].reduce((a, l) => a + l.amount, 0);
    const sumOther = otherLines.reduce((a, l) => a + (l.amount || 0), 0);
    const total = sumSel + sumOther - (doc.cashBack || 0);
    clear(totals);
    totals.append(el('div.tot-row', {}, el('dt', {}, '다른 자금 합계'), el('dd.money', {}, formatMoney(sumOther))));
    totals.append(el('div.tot-row', {}, el('dt', {}, '선택한 영수'), el('dd.money', {}, formatMoney(sumSel))));
    if (doc.cashBack) totals.append(el('div.tot-row', {}, el('dt', {}, '현금 인출'), el('dd.money', {}, `-${formatMoney(doc.cashBack)}`)));
    totals.append(el('div.tot-row.tot-total', {}, el('dt', {}, '합계'), el('dd.money', {}, formatMoney(total))));
    head.set(total);
  }
  refresh();
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: '적요' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });
  const depositFiles = attachmentsBlock(doc, touch);

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {}, field('계정과목', acct, { required: true })),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {}, field('날짜', date, { required: true })))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, '이 입금은 무효 처리되었습니다.')) : null,
    el('section.doc-lines', { 'aria-label': '입금할 영수' }, el('h2.doc-section-title', {}, '입금 대기 중인 영수'), pendingBox),
    el('section.doc-lines', { 'aria-label': '기타 입금액' }, el('h2.doc-section-title', {}, '입금에 포함될 기타 자금'), grid.root),
    el('div.doc-bottom', {},
      el('div.doc-notes', {}, field('적요', memo), el('div.form-grid', {}, field('현금 인출 대상 계정', cashBackAcct), field('현금 인출액', cashBack)), depositFiles),
      totals));

  const frame = openFrame({
    title: '입금',
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    isDirty: () => dirty,
    onAddLine: () => grid.addLine(),
    history: recentMenu('deposit', async (tid) => { if (await frame.requestClose()) openDepositForm({ id: tid }); }),
    onRecurring: () => openRecurringFromTxn({ ...doc, lines: filledLines(otherLines) }),
    more: txnMoreActions(existing, { reopen: (t) => openDepositForm({ id: t.id }), close: () => frame.requestClose() }),
    onSave: (mode) => {
      const record = { ...doc, lines: [...selected.values(), ...filledLines(otherLines)] };
      const saved = store.saveTxn(record);
      dirty = false;
      depositFiles.commit();
      toast('입금이 저장되었습니다');
      onSaved?.(saved);
      if (mode === 'new') { frame.close(); openDepositForm(); }
      else if (mode === 'stay') { frame.close(); openDepositForm({ id: saved.id }); }
      return true;
    },
  });
  return frame;
}

// --------------------------------------------------------------- transfer

export function openTransferForm({ type = 'transfer', id = null, draft = null, onSaved = null } = {}) {
  const cc = type === 'ccPayment';
  const existing = id ? store.txn(id) : null;
  const doc = existing ? structuredClone(existing) : cc
    ? { id: newId(), type, date: today(), ccAccountId: store.accountsOfType('creditCard')[0]?.id || null, bankAccountId: store.accountsOfType('bank')[0]?.id || null, amount: 0, memo: '', ...(draft || {}) }
    : { id: newId(), type, date: today(), fromId: store.accountsOfType('bank')[0]?.id || null, toId: store.accountsOfType('bank')[1]?.id || null, amount: 0, memo: '', ...(draft || {}) };
  if (!doc.id) doc.id = newId();
  let dirty = !!draft;
  const touch = () => { dirty = true; };
  const head = headline(cc ? '지출 금액' : '이체 금액');
  head.set(doc.amount || 0);
  const balHint = (getId) => {
    const h = el('div.field-hint');
    const paint = () => { const v = getId(); h.textContent = v ? `잔액 ${formatMoney(store.accountBalance(v))}` : ''; };
    paint();
    return { h, paint };
  };
  const fromBal = balHint(() => (cc ? doc.bankAccountId : doc.fromId));
  const toBal = balHint(() => (cc ? doc.ccAccountId : doc.toId));
  const from = accountPicker({ value: cc ? doc.bankAccountId : doc.fromId, types: cc ? ['bank'] : ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity', 'fixedAsset', 'otherAsset'], ariaLabel: cc ? '은행 계정' : '이체 출금 계정', onChange: (v) => { if (cc) doc.bankAccountId = v; else doc.fromId = v; fromBal.paint(); touch(); } });
  const to = accountPicker({ value: cc ? doc.ccAccountId : doc.toId, types: cc ? ['creditCard'] : ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity', 'fixedAsset', 'otherAsset'], ariaLabel: cc ? '신용카드' : '이체 입금 계정', onChange: (v) => { if (cc) doc.ccAccountId = v; else doc.toId = v; toBal.paint(); touch(); } });
  const payee = cc ? contactPicker({ kind: 'vendor', value: doc.contactId, ariaLabel: '지출 수취인', placeholder: '카드 발급사 (선택 사항)', onChange: (v) => { doc.contactId = v; touch(); } }) : null;
  const amount = moneyInput({ value: doc.amount || null, ariaLabel: cc ? '금액' : '이체 금액', onChange: (v) => { doc.amount = v || 0; head.set(doc.amount); touch(); } });
  const date = dateInput({ value: doc.date, ariaLabel: '날짜', required: true, onChange: (v) => { doc.date = v; touch(); } });
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: '적요' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const body = el('div.doc-sheet.doc-narrow', {},
    el('div.doc-band', {},
      el('div.doc-party', {},
        cc ? field('결제한 신용카드는 어떤 것인가요?', to, { required: true }) : el('div', {}, field('이체 출금 계정', from, { required: true }), fromBal.h),
        cc ? toBal.h : null,
        cc ? field('지출 수취인', payee) : el('div', {}, field('이체 입금 계정', to, { required: true }), toBal.h),
        cc ? el('div', {}, field('이 지출에 무엇을 사용했나요?', from, { required: true }), fromBal.h) : null),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {}, field('금액', amount, { required: true }), field('날짜', date, { required: true })))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, `이 ${TXN_TYPES[type].label} 거래는 무효 처리되었습니다.`)) : null,
    el('div.doc-bottom', {}, el('div.doc-notes', {}, field('적요', memo)), el('div')));

  const meta = TXN_TYPES[type];
  const frame = openFrame({
    title: meta.label,
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    isDirty: () => dirty,
    history: recentMenu(type, async (tid) => { if (await frame.requestClose()) openTransferForm({ type, id: tid }); }),
    onRecurring: () => openRecurringFromTxn({ ...doc }),
    more: txnMoreActions(existing, { reopen: (t) => openTransferForm({ type: t.type, id: t.id }), close: () => frame.requestClose() }),
    onSave: (mode) => {
      const saved = store.saveTxn({ ...doc });
      dirty = false;
      toast(`${meta.label} 저장됨`);
      onSaved?.(saved);
      if (mode === 'new') { frame.close(); openTransferForm({ type }); }
      else if (mode === 'stay') { frame.close(); openTransferForm({ type, id: saved.id }); }
      return true;
    },
  });
  return frame;
}

// ---------------------------------------------------------------- journal

export function openJournalForm({ id = null, draft = null, onSaved = null } = {}) {
  const existing = id ? store.txn(id) : null;
  const doc = existing ? structuredClone(existing) : { id: newId(), type: 'journal', date: today(), num: store.nextNumber('journal'), lines: [], memo: '', attachments: [], ...(draft || {}) };
  if (!doc.id) doc.id = newId();
  const lines = (doc.lines || []).map((l) => ({ ...l }));
  let dirty = !!draft;
  const touch = () => { dirty = true; };
  const date = dateInput({ value: doc.date, ariaLabel: '분개 날짜', required: true, onChange: (v) => { doc.date = v; touch(); } });
  const num = textInput({ value: doc.num || '', ariaLabel: '분개 번호' });
  num.addEventListener('input', () => { doc.num = num.value.trim(); touch(); });
  const totals = el('dl.doc-totals');

  const amountCell = (key) => (line, row) => {
    const m = moneyInput({ value: line[key] || null, ariaLabel: `${key === 'debit' ? '차변' : '대변'}, ${row.index + 1}행`, onChange: (v) => {
      line[key] = v || 0;
      // A line is a debit or a credit, not both.
      if (v) {
        const other = key === 'debit' ? 'credit' : 'debit';
        if (line[other]) {
          line[other] = 0;
          m.root.closest('tr')?.querySelector(`[data-k="${other}"]`)?.dispatchEvent(new CustomEvent('external', { detail: null }));
        }
      }
      row.changed();
    } });
    m.input.dataset.k = key;
    m.input.addEventListener('external', (e) => { m.value = e.detail; });
    return m.root;
  };

  const grid = lineGrid({
    ariaLabel: '분개 행',
    lines,
    makeLine: () => ({ accountId: null, debit: 0, credit: 0, desc: '', contactId: null }),
    isBlank: (l) => !l.accountId && !l.debit && !l.credit && !l.desc && !l.contactId,
    onChange: () => { touch(); refresh(); },
    columns: [
      { key: 'acct', label: '계정과목', width: '28%', cell: (line, row) => { const picker = accountPicker({ value: line.accountId, ariaLabel: `계정과목, ${row.index + 1}행`, onChange: (v) => {
        line.accountId = v;
        // Picking an account on an empty line fills the amount that balances
        // the entry, as accountants expect.
        const others = lines.filter((l) => l !== line);
        const gap = others.reduce((a, l) => a + (l.debit || 0) - (l.credit || 0), 0);
        if (v && !line.debit && !line.credit && gap) {
          if (gap > 0) line.credit = gap; else line.debit = -gap;
          const tr = picker.root.closest('tr');
          tr?.querySelector('[data-k="debit"]')?.dispatchEvent(new CustomEvent('external', { detail: line.debit || null }));
          tr?.querySelector('[data-k="credit"]')?.dispatchEvent(new CustomEvent('external', { detail: line.credit || null }));
        }
        row.changed();
      } }); return picker.root; } },
      { key: 'debit', label: '차변', width: '130px', align: 'right', cell: amountCell('debit') },
      { key: 'credit', label: '대변', width: '130px', align: 'right', cell: amountCell('credit') },
      { key: 'desc', label: '설명', cell: (line, row) => { const i = textInput({ value: line.desc || '', ariaLabel: `설명, ${row.index + 1}행` }); i.addEventListener('input', () => { line.desc = i.value; row.changed(); }); return i; } },
      { key: 'name', label: '이름', width: '20%', cell: (line, row) => contactPicker({ kind: 'any', value: line.contactId, ariaLabel: `이름, ${row.index + 1}행`, onChange: (v) => { line.contactId = v; row.changed(); } }).root },
    ],
  });

  function refresh() {
    const d = lines.reduce((a, l) => a + (l.debit || 0), 0);
    const c = lines.reduce((a, l) => a + (l.credit || 0), 0);
    clear(totals);
    totals.append(el('div.tot-row', {}, el('dt', {}, '차변 합계'), el('dd.money', {}, formatMoney(d))));
    totals.append(el('div.tot-row', {}, el('dt', {}, '대변 합계'), el('dd.money', {}, formatMoney(c))));
    if (d !== c) totals.append(el('div.tot-row.tot-warn', { role: 'status' }, el('dt', {}, '분개 불균형'), el('dd.money', {}, formatMoney(Math.abs(d - c)))));
  }
  refresh();
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: '적요' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const journalFiles = attachmentsBlock(doc, touch);
  const body = el('div.doc-sheet', {},
    el('div.doc-band.doc-band-plain', {}, el('div.doc-meta.doc-meta-inline', {}, field('분개 날짜', date, { required: true }), field('분개 번호', num))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, '이 분개는 무효 처리되었습니다.')) : null,
    el('section.doc-lines', { 'aria-label': '분개 행' }, grid.root),
    el('div.doc-bottom', {}, el('div.doc-notes', {}, field('적요', memo), journalFiles), totals));

  const frame = openFrame({
    title: existing ? `분개 #${doc.num || ''}` : '분개',
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    isDirty: () => dirty,
    onAddLine: () => grid.addLine(),
    history: recentMenu('journal', async (tid) => { if (await frame.requestClose()) openJournalForm({ id: tid }); }),
    onRecurring: () => openRecurringFromTxn({ ...doc, lines: filledLines(lines).map(stripSuggest) }),
    more: txnMoreActions(existing, { reopen: (t) => openJournalForm({ id: t.id }), close: () => frame.requestClose() }),
    onSave: (mode) => {
      const record = { ...doc, lines: filledLines(lines, (l) => !l.accountId && !l.debit && !l.credit).map(stripSuggest) };
      const saved = store.saveTxn(record);
      dirty = false;
      journalFiles.commit();
      toast('분개가 저장되었습니다');
      onSaved?.(saved);
      if (mode === 'new') { frame.close(); openJournalForm(); }
      else if (mode === 'stay') { frame.close(); openJournalForm({ id: saved.id }); }
      return true;
    },
  });
  return frame;
}

function stripSuggest(l) {
  const c = { ...l };
  delete c._suggest;
  return c;
}
