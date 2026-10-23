/**
 * Customer payment and bill payment (vendors): one form. Pick the
 * contact, see their open documents oldest first, and apply money (and any
 * unapplied credits) to them. Typing the amount received spreads it over the
 * oldest documents; ticking a document applies its open balance.
 */
import { el, clear } from '../ui/dom.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { openFrame } from './frame.js';
import { contactPicker, accountPicker, headline, attachmentsBlock, recentMenu } from './common.js';
import { store } from '../lib/store.js';
import { newId } from '../lib/ids.js';
import { TXN_TYPES, PAYMENT_METHODS } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today, formatDate } from '../lib/dates.js';
import { txnMoreActions } from './actions.js';

export function openPaymentForm({ type = 'payment', id = null, draft = null, onSaved = null } = {}) {
  const ar = type === 'payment';
  const meta = TXN_TYPES[type];
  const docType = ar ? 'invoice' : 'bill';
  const creditType = ar ? 'creditMemo' : 'vendorCredit';
  const existing = id ? store.txn(id) : null;
  const preselect = draft?.preselect || null;
  const doc = existing ? structuredClone(existing) : {
    id: newId(), type, date: today(), contactId: null, amount: 0, applied: [], memo: '', attachments: [],
    ...(ar
      ? { depositToId: store.settings.paymentsToUndeposited ? store.roleAccount('undeposited') : store.accountsOfType('bank')[0]?.id || store.roleAccount('undeposited') }
      : { accountId: store.accountsOfType('bank')[0]?.id || null }),
    ...(draft || {}),
  };
  delete doc.preselect;
  if (!doc.id) doc.id = newId();
  let dirty = !!draft;
  let amountTouched = !!existing;
  // Typing the amount spreads it over the oldest documents, except on a saved
  // payment, whose applications the user chose (until its contact changes).
  let spread = !existing;
  const touch = () => { dirty = true; };
  const head = headline(ar ? '수납 금액' : '지출 합계');

  // applied amounts per document, and per credit
  let rows = [];
  let creditRows = [];
  const applied = new Map((doc.applied || []).map((a) => [a.txnId, a.amount]));
  const creditUse = new Map();

  function loadRows() {
    rows = doc.contactId ? store.openDocs(doc.contactId, docType, existing?.id) : [];
    creditRows = doc.contactId ? store.openCredits(doc.contactId, creditType, null) : [];
    creditUse.clear();
  }

  // ---------------------------------------------------------------- header
  const contact = contactPicker({
    kind: ar ? 'customer' : 'vendor', value: doc.contactId, ariaLabel: ar ? '고객' : '공급처',
    onChange: (v) => {
      doc.contactId = v;
      applied.clear();
      spread = true;
      touch();
      loadRows();
      if (!amountTouched) doc.amount = 0;
      paint();
    },
  });
  const date = dateInput({ value: doc.date, ariaLabel: '영수/지출 날짜', required: true, onChange: (v) => { doc.date = v; touch(); } });
  const method = selectInput({ options: [['', '방법 선택'], ...PAYMENT_METHODS.map((m) => [m, m])], value: doc.paymentMethod || '', ariaLabel: '지불 수단', onChange: (v) => { doc.paymentMethod = v; touch(); } });
  const ref = textInput({ value: doc.ref || doc.num || '', ariaLabel: '참조 번호' });
  ref.addEventListener('input', () => { doc.ref = ref.value; touch(); });
  const account = ar
    ? accountPicker({ value: doc.depositToId, types: ['bank', 'otherCurrentAsset', 'creditCard'], ariaLabel: '입금 계정', onChange: (v) => { doc.depositToId = v; touch(); } })
    : accountPicker({ value: doc.accountId, types: ['bank', 'creditCard'], ariaLabel: '지출 계정', onChange: (v) => { doc.accountId = v; touch(); paintBal(); } });
  const bal = el('div.field-hint');
  const paintBal = () => { bal.textContent = !ar && doc.accountId ? `잔액 ${formatMoney(store.accountBalance(doc.accountId))}` : ''; };
  paintBal();
  const amount = moneyInput({ value: doc.amount || null, ariaLabel: ar ? '수납 금액' : '지출 금액', onChange: (v, final) => {
    doc.amount = v || 0;
    amountTouched = true;
    touch();
    if (final && spread) { autoApply(); syncChecks(); }
    paintTotals();
  } });

  // Spread the amount over the oldest documents.
  function autoApply() {
    let left = doc.amount;
    for (const r of rows) {
      const take = Math.max(0, Math.min(left, r.open));
      setApplied(r.txn.id, take);
      left -= take;
    }
  }

  // ----------------------------------------------------------------- tables
  // The tables are rebuilt only when the contact changes. Ticking a box or
  // typing a payment updates the cells in place, so focus and clicks never
  // land on a row that was just replaced.
  const tableBox = el('div');
  const creditBox = el('div');
  const totals = el('dl.doc-totals');
  let rowRefs = new Map(); // doc id -> { cb, pay, tr, open }
  let allCb = null;

  function setApplied(id, value, { fromInput = false } = {}) {
    const ref = rowRefs.get(id);
    const v = Math.max(0, Math.min(value || 0, ref ? ref.open : value || 0));
    applied.set(id, v);
    if (!ref) return;
    ref.cb.checked = v > 0;
    ref.tr.classList.toggle('is-selected', v > 0);
    if (!fromInput || document.activeElement !== ref.pay.input) ref.pay.value = v || null;
  }

  function syncChecks() {
    if (allCb) allCb.checked = rows.length > 0 && rows.every((r) => (applied.get(r.txn.id) || 0) > 0);
  }

  function docTable() {
    rowRefs = new Map();
    const table = el('table.grid.apply-table', { 'aria-label': ar ? '미결 청구서' : '미결 매입채무' });
    allCb = el('input', { type: 'checkbox', 'aria-label': '전체 적용' });
    allCb.addEventListener('change', () => {
      for (const r of rows) setApplied(r.txn.id, allCb.checked ? r.open : 0);
      syncAmount();
      paintTotals();
    });
    table.append(el('thead', {}, el('tr', {},
      el('th.check-cell', { scope: 'col' }, allCb),
      el('th', { scope: 'col' }, '설명'),
      el('th', { scope: 'col' }, '기한'),
      el('th.num', { scope: 'col' }, '원래 금액'),
      el('th.num', { scope: 'col' }, '미결 잔액'),
      el('th.num', { scope: 'col', style: { width: '150px' } }, '지출'))));
    const tb = el('tbody');
    for (const r of rows) {
      const label = `${TXN_TYPES[r.txn.type].label} ${r.txn.num || ''}`.trim();
      const cb = el('input', { type: 'checkbox', 'aria-label': `${label}에 적용` });
      const pay = moneyInput({ value: null, ariaLabel: `${label} 지출액`, onChange: (v) => {
        setApplied(r.txn.id, v, { fromInput: true });
        syncChecks();
        syncAmount();
        paintTotals();
      } });
      cb.addEventListener('change', () => {
        setApplied(r.txn.id, cb.checked ? r.open : 0);
        syncChecks();
        syncAmount();
        paintTotals();
      });
      const tr = el('tr', {},
        el('td.check-cell', {}, cb),
        el('td', {}, el('a', { href: `#/txn/${r.txn.id}` }, `${TXN_TYPES[r.txn.type].label} #${r.txn.num || ''}`), el('span.cell-sub', {}, ` (${formatDate(r.txn.date)})`)),
        el('td', {}, formatDate(r.txn.dueDate || r.txn.date)),
        el('td.num', {}, formatMoney(r.total)),
        el('td.num', {}, formatMoney(r.open)),
        el('td.num', {}, pay.root));
      rowRefs.set(r.txn.id, { cb, pay, tr, open: r.open });
      setApplied(r.txn.id, applied.get(r.txn.id) || 0);
      tb.append(tr);
    }
    table.append(tb);
    syncChecks();
    return el('div.table-wrap', {}, el('div.table-scroll', {}, table));
  }

  function creditTable() {
    if (!creditRows.length) return null;
    const table = el('table.grid.apply-table', { 'aria-label': '대변' });
    table.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, '대변'), el('th.num', { scope: 'col' }, '원래 금액'), el('th.num', { scope: 'col' }, '사용 가능'), el('th.num', { scope: 'col', style: { width: '150px' } }, '사용액'))));
    const tb = el('tbody');
    for (const c of creditRows) {
      const use = moneyInput({ value: creditUse.get(c.txn.id) || null, ariaLabel: `대변 사용 ${c.txn.num || ''}`, onChange: (v) => {
        creditUse.set(c.txn.id, Math.min(v || 0, c.open));
        syncAmount();
        paintTotals();
      } });
      tb.append(el('tr', {},
        el('td', {}, el('a', { href: `#/txn/${c.txn.id}` }, `${TXN_TYPES[c.txn.type].label} #${c.txn.num || ''}`), el('span.cell-sub', {}, ` (${formatDate(c.txn.date)})`)),
        el('td.num', {}, formatMoney(c.total)),
        el('td.num', {}, formatMoney(c.open)),
        el('td.num', {}, use.root)));
    }
    table.append(tb);
    return el('section', { 'aria-label': '대변' }, el('h2.doc-section-title', {}, '대변'), el('p.field-hint', {}, '사용한 대변은 위에서 선택한 문서에 오래된 것부터 적용됩니다.'), el('div.table-wrap', {}, table));
  }

  function syncAmount() {
    touch();
    const sumApplied = [...applied.values()].reduce((a, b) => a + b, 0);
    const credits = [...creditUse.values()].reduce((a, b) => a + b, 0);
    // Without a typed amount, the amount follows what is applied less credits used.
    if (!amountTouched || sumApplied - credits > doc.amount) {
      doc.amount = Math.max(0, sumApplied - credits);
      amount.value = doc.amount || null;
    }
  }

  function paintTotals() {
    clear(totals);
    const sumApplied = [...applied.values()].reduce((a, b) => a + b, 0);
    const credits = [...creditUse.values()].reduce((a, b) => a + b, 0);
    const toApply = doc.amount + credits;
    const row = (l, v, cls = '') => totals.append(el('div.tot-row', { class: cls }, el('dt', {}, l), el('dd.money', {}, formatMoney(v))));
    row('적용할 금액', toApply);
    row('적용된 금액', sumApplied);
    if (toApply - sumApplied > 0) row(ar ? '대변으로 남는 금액' : '적용되지 않은 금액', toApply - sumApplied, 'tot-total');
    head.set(doc.amount);
  }

  function paint() {
    clear(tableBox);
    allCb = null;
    rowRefs = new Map();
    if (!doc.contactId) {
      tableBox.append(el('div.empty', {}, el('p', {}, ar ? '고객을 선택하면 미결 청구서가 표시됩니다.' : '공급처를 선택하면 미결 매입채무가 표시됩니다.')));
    } else if (!rows.length) {
      tableBox.append(el('div.empty', {}, el('p', {}, ar ? '이 고객의 미결 청구서가 없습니다. 영수는 대변으로 보관됩니다.' : '이 공급처의 미결 매입채무가 없습니다. 지출은 대변으로 보관됩니다.')));
    } else tableBox.append(docTable());
    clear(creditBox);
    const ct = creditTable();
    if (ct) creditBox.append(ct);
    paintTotals();
  }

  loadRows();
  if (preselect) {
    const r = rows.find((x) => x.txn.id === preselect);
    if (r) { applied.set(r.txn.id, r.open); doc.amount = r.open; amount.value = r.open; }
  }
  paint();

  const attachments = attachmentsBlock(doc, touch);
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: '적요' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {}, field(ar ? '고객' : '공급처', contact, { required: true })),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {},
        field('영수/지출 날짜', date, { required: true }),
        field('지불 수단', method),
        field('참조 번호', ref),
        el('div', {}, field(ar ? '입금 계정' : '지출 계정', account, { required: true }), bal),
        field(ar ? '수납 금액' : '금액', amount)))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, '이 영수/지출은 무효 처리되었습니다.')) : null,
    el('section.doc-lines', { 'aria-label': ar ? '미결 거래' : '매입채무' }, el('h2.doc-section-title', {}, ar ? '미결 거래' : '매입채무'), tableBox),
    creditBox,
    el('div.doc-bottom', {}, el('div.doc-notes', {}, field('적요', memo), attachments), totals));

  async function save(mode) {
    const credits = [...creditUse.entries()].filter(([, v]) => v > 0);
    // Credits go first: apply each to the ticked documents, oldest first,
    // then the money covers the rest.
    const remaining = new Map(applied);
    const creditWrites = [];
    for (const [cid, amt] of credits) {
      let left = amt;
      const credit = store.txn(cid);
      const list = [...(credit.applied || [])];
      for (const r of rows) {
        const want = remaining.get(r.txn.id) || 0;
        if (left <= 0 || want <= 0) continue;
        const take = Math.min(left, want);
        list.push({ txnId: r.txn.id, amount: take });
        remaining.set(r.txn.id, want - take);
        left -= take;
      }
      creditWrites.push({ ...credit, applied: list });
    }
    const record = { ...doc, applied: [...remaining.entries()].filter(([, v]) => v > 0).map(([txnId, amount]) => ({ txnId, amount })) };
    // Check everything before writing anything, so a refused payment never
    // leaves its credits applied.
    for (const c of creditWrites) store.assertTxn(c);
    // Only credits, and no money: there is no payment to save. A saved
    // payment emptied this way is still validated (and refused) as one below.
    if (!existing && record.amount <= 0 && !record.applied.length) {
      if (!creditWrites.length) throw new Error('금액을 입력하거나 적용할 항목을 선택하세요.');
      for (const c of creditWrites) store.saveTxn(c);
      toast('대변이 적용되었습니다');
      dirty = false;
      if (mode === 'new') { frame.close(); openPaymentForm({ type }); }
      else if (mode === 'stay') {
        // Start over from the books as they are now, so saving again cannot
        // apply the same credits a second time.
        applied.clear();
        loadRows();
        doc.amount = 0;
        amount.value = null;
        amountTouched = false;
        paint();
      }
      return true;
    }
    const sumApplied = record.applied.reduce((a, b) => a + b.amount, 0);
    if (sumApplied > record.amount) throw new Error('지출액이 적용된 금액보다 적습니다. 지출액을 낮추거나 금액을 늘리세요.');
    store.assertTxn(record);
    for (const c of creditWrites) store.saveTxn(c);
    const saved = store.saveTxn(record);
    dirty = false;
    attachments.commit();
    toast(`${meta.label} 저장됨`);
    onSaved?.(saved);
    if (mode === 'new') { frame.close(); openPaymentForm({ type }); }
    else if (mode === 'stay') { frame.close(); openPaymentForm({ type, id: saved.id }); }
    return true;
  }

  const frame = openFrame({
    title: ar ? (existing ? '영수' : '영수 기록') : existing ? '매입채무 지출' : '매입채무 지급',
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    onSave: save,
    isDirty: () => dirty,
    history: recentMenu(type, async (tid) => { if (await frame.requestClose()) openPaymentForm({ type, id: tid }); }),
    more: txnMoreActions(existing, { reopen: (t) => openPaymentForm({ type: t.type, id: t.id }), close: () => frame.requestClose() }),
  });
  return frame;
}

/**
 * Pay bills: every open bill across vendors, one payment account and date,
 * one bill payment per vendor.
 */
export function openPayBills() {
  const bills = [];
  const info = store.docInfo();
  for (const t of store.txns.values()) {
    if (t.type !== 'bill' || t.voided) continue;
    const open = info.open.get(t.id) || 0;
    if (open > 0) bills.push({ txn: t, open });
  }
  bills.sort((a, b) => (a.txn.dueDate || a.txn.date).localeCompare(b.txn.dueDate || b.txn.date));
  const pay = new Map();
  let accountId = store.accountsOfType('bank')[0]?.id || null;
  let date = today();
  let method = 'Check';
  let dirty = false;
  const head = headline('지출 합계');
  const acct = accountPicker({ value: accountId, types: ['bank', 'creditCard'], ariaLabel: '지출 계정', onChange: (v) => { accountId = v; paintBal(); } });
  const bal = el('div.field-hint');
  const paintBal = () => { bal.textContent = accountId ? `잔액 ${formatMoney(store.accountBalance(accountId))}` : ''; };
  paintBal();
  const dateIn = dateInput({ value: date, ariaLabel: '영수/지출 날짜', onChange: (v) => { date = v; } });
  const methodSel = selectInput({ options: PAYMENT_METHODS.map((m) => [m, m]), value: method, ariaLabel: '지불 수단', onChange: (v) => { method = v; } });
  const filterSel = selectInput({ options: [['all', '모든 미결 매입채무'], ['overdue', '기한 경과만'], ['due7', '7일 이내 기한인 항목']], value: 'all', ariaLabel: '필터', onChange: () => paint() });
  const tableBox = el('div');
  const totalLine = el('dl.doc-totals');

  function paint() {
    clear(tableBox);
    const now = today();
    const f = filterSel.value;
    const list = bills.filter((b) => f === 'all' || (f === 'overdue' ? (b.txn.dueDate || b.txn.date) < now : (b.txn.dueDate || b.txn.date) <= addDaysISO(now, 7)));
    // Only bills on screen get paid.
    const visible = new Set(list.map((b) => b.txn.id));
    for (const id of [...pay.keys()]) if (!visible.has(id)) pay.delete(id);
    if (!list.length) {
      tableBox.append(el('div.empty', {}, el('h2', {}, '미결 매입채무 없음'), el('p', {}, '입력한 매입채무는 지급될 때까지 여기에 표시됩니다.')));
      paintTotal();
      return;
    }
    const table = el('table.grid.apply-table', { 'aria-label': '미결 매입채무' });
    table.append(el('thead', {}, el('tr', {},
      el('th.check-cell', { scope: 'col' }, el('span.sr-only', {}, '지급')),
      el('th', { scope: 'col' }, '공급처'), el('th', { scope: 'col' }, '참조 번호'), el('th', { scope: 'col' }, '기한'),
      el('th.num', { scope: 'col' }, '미결 잔액'), el('th.num', { scope: 'col', style: { width: '150px' } }, '지출'))));
    const tb = el('tbody');
    for (const b of list) {
      const overdue = (b.txn.dueDate || b.txn.date) < now;
      const cb = el('input', { type: 'checkbox', checked: (pay.get(b.txn.id) || 0) > 0, 'aria-label': `${store.contactName(b.txn.contactId)}의 매입채무 지급` });
      const amt = moneyInput({ value: pay.get(b.txn.id) || null, ariaLabel: `${store.contactName(b.txn.contactId)}의 매입채무 지출액`, onChange: (v, final) => {
        const capped = Math.min(v || 0, b.open);
        pay.set(b.txn.id, capped);
        if (final && (v || 0) > b.open) amt.value = capped;
        cb.checked = capped > 0;
        dirty = true;
        paintTotal();
      } });
      cb.addEventListener('change', () => { pay.set(b.txn.id, cb.checked ? b.open : 0); amt.value = cb.checked ? b.open : null; dirty = true; paintTotal(); });
      tb.append(el('tr', {},
        el('td.check-cell', {}, cb),
        el('td', {}, store.contactName(b.txn.contactId)),
        el('td', {}, el('a', { href: `#/txn/${b.txn.id}` }, b.txn.num || '매입채무')),
        el('td', {}, formatDate(b.txn.dueDate || b.txn.date), overdue ? el('span.badge.badge-negative', { style: { marginLeft: '8px' } }, '기한 경과') : null),
        el('td.num', {}, formatMoney(b.open)),
        el('td.num', {}, amt.root)));
    }
    table.append(tb);
    tableBox.append(el('div.table-wrap', {}, el('div.table-scroll', {}, table)));
    paintTotal();
  }

  function paintTotal() {
    const total = [...pay.values()].reduce((a, b) => a + b, 0);
    head.set(total);
    clear(totalLine);
    totalLine.append(el('div.tot-row.tot-total', {}, el('dt', {}, '지출 합계'), el('dd.money', {}, formatMoney(total))));
  }
  paint();

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {}, el('div', {}, field('지출 계정', acct, { required: true }), bal), field('표시', filterSel)),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {}, field('영수/지출 날짜', dateIn), field('지불 수단', methodSel)))),
    el('section.doc-lines', { 'aria-label': '미결 매입채무' }, tableBox),
    el('div.doc-bottom', {}, el('div'), totalLine));

  const frame = openFrame({
    title: '매입채무 지급',
    body,
    hideSaveNew: true,
    isDirty: () => dirty,
    onSave: () => {
      if (!accountId) throw new Error('지출할 계정을 선택하세요.');
      const byVendor = new Map();
      for (const [billId, amt] of pay) {
        if (amt <= 0) continue;
        const b = store.txn(billId);
        if (!byVendor.has(b.contactId)) byVendor.set(b.contactId, []);
        byVendor.get(b.contactId).push({ txnId: billId, amount: amt });
      }
      if (!byVendor.size) throw new Error('지급할 매입채무를 하나 이상 선택하세요.');
      let n = 0;
      for (const [vendorId, list] of byVendor) {
        store.saveTxn({ type: 'billPayment', date, contactId: vendorId, accountId, paymentMethod: method, amount: list.reduce((a, b) => a + b.amount, 0), applied: list });
        n++;
      }
      dirty = false;
      toast(`매입채무 지출 ${n}건이 기록되었습니다`);
      frame.close();
      return true;
    },
  });
  return frame;
}

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
