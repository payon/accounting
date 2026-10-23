/**
 * Purchase documents: expense, check, bill, vendor credit, credit card
 * credit, purchase order. Category lines and item lines, like a paper
 * voucher with two sections.
 */
import { el, clear } from '../ui/dom.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { openFrame } from './frame.js';
import { contactPicker, itemPicker, accountPicker, lineGrid, filledLines, attachmentsBlock, headline, recentMenu, parseQty, mobileExtras } from './common.js';
import { store } from '../lib/store.js';
import { newId } from '../lib/ids.js';
import { TXN_TYPES, dueDateFor, PAYMENT_METHODS, lineTotal } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today } from '../lib/dates.js';
import { printTxn } from '../ui/print.js';
import { txnMoreActions } from './actions.js';
import { openRecurringFromTxn } from './recurring.js';

const CONFIG = {
  expense: { payee: 'any', payFrom: true, method: true, dateLabel: '지출 날짜', refLabel: '참조 번호', headline: '합계' },
  check: { payee: 'any', payFrom: true, bankOnly: true, dateLabel: '지출 날짜', refLabel: '수표 번호', numIsRef: true, headline: '합계' },
  bill: { payee: 'vendor', terms: true, dateLabel: '매입채무 날짜', refLabel: '매입채무 번호', headline: '결제 예정 금액' },
  vendorCredit: { payee: 'vendor', dateLabel: '지출 날짜', refLabel: '참조 번호', headline: '대변 금액' },
  ccCredit: { payee: 'any', payFrom: true, cardOnly: true, dateLabel: '지출 날짜', refLabel: '참조 번호', headline: '대변 금액' },
  purchaseOrder: { payee: 'vendor', dateLabel: '발주서 날짜', refLabel: '발주 번호', po: true, headline: '금액' },
};

function mailingFor(c) {
  const a = c.billAddr || {};
  return [c.company || c.displayName, a.line1, a.line2, [a.city, a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join('\n');
}

const EXPENSE_TYPES = ['expense', 'cogs', 'otherExpense', 'fixedAsset', 'otherAsset', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity', 'income', 'otherIncome'];

export function openPurchaseForm({ type = 'expense', id = null, draft = null, onSaved = null } = {}) {
  const cfg = CONFIG[type];
  const meta = TXN_TYPES[type];
  const existing = id ? store.txn(id) : null;
  const defaultPayFrom = () => {
    if (cfg.cardOnly) return store.accountsOfType('creditCard')[0]?.id || null;
    if (cfg.bankOnly) return store.accountsOfType('bank')[0]?.id || null;
    return store.accountsOfType('bank')[0]?.id || store.accountsOfType('creditCard')[0]?.id || null;
  };
  const doc = existing ? structuredClone(existing) : {
    id: newId(),
    type,
    date: today(),
    num: type === 'purchaseOrder' ? store.nextNumber(type) : type === 'check' ? nextCheckNumber() : '',
    contactId: null,
    lines: [],
    memo: '',
    attachments: [],
    ...(cfg.payFrom ? { accountId: defaultPayFrom() } : {}),
    ...(cfg.terms ? { terms: store.settings.defaultTerms } : {}),
    ...(cfg.po ? { status: 'open' } : {}),
    ...(draft || {}),
  };
  if (!doc.id) doc.id = newId();
  // A vendor chosen before the form opened (Create bill on a vendor, copying
  // a purchase order) brings what choosing it here would, unless the draft
  // says otherwise.
  if (!existing && draft?.contactId) {
    const c = store.contact(draft.contactId);
    if (c) {
      if (draft.address === undefined) doc.address = mailingFor(c);
      if (cfg.terms && c.terms && draft.terms === undefined) doc.terms = c.terms;
      if (c.defaultAccountId && !(draft.lines || []).length) doc.lines = [{ accountId: c.defaultAccountId, desc: '', amount: 0, customerId: null }];
    }
  }
  if (cfg.terms && !doc.dueDate) doc.dueDate = dueDateFor(doc.date, doc.terms, store.settings.terms);
  const catLines = (doc.lines || []).filter((l) => !l.itemId).map((l) => ({ ...l }));
  const itemLines = (doc.lines || []).filter((l) => l.itemId).map((l) => ({ ...l }));
  let dirty = !!draft;
  const touch = () => { dirty = true; };
  const head = headline(cfg.headline);

  function nextCheckNumber() {
    let max = 0;
    for (const t of store.txns.values()) if (t.type === 'check' && /^\d+$/.test(t.num || '')) max = Math.max(max, +t.num);
    return max ? String(max + 1) : '';
  }

  // ------------------------------------------------------------- payee
  const mailing = textArea({ value: doc.address || '', rows: 3, ariaLabel: '우편 주소' });
  mailing.addEventListener('input', () => { doc.address = mailing.value; touch(); });
  const payee = contactPicker({
    kind: cfg.payee, value: doc.contactId, ariaLabel: cfg.payee === 'vendor' ? '공급처' : '지출 수취인',
    onChange: (v) => {
      doc.contactId = v;
      touch();
      const c = store.contact(v);
      if (c) {
        doc.address = mailingFor(c);
        mailing.value = doc.address;
        if (c.defaultAccountId && !catLines.some((l) => l.accountId)) {
          if (!catLines.length) catLines.push(makeCat());
          catLines[0].accountId = c.defaultAccountId;
          cats.render();
        }
        if (cfg.terms && c.terms) { doc.terms = c.terms; termsSel.value = c.terms; doc.dueDate = dueDateFor(doc.date, c.terms, store.settings.terms); due.value = doc.dueDate; }
      }
    },
  });

  // -------------------------------------------------------------- meta
  const payFromBalance = el('div.field-hint');
  const paintBalance = () => {
    payFromBalance.textContent = doc.accountId ? `잔액 ${formatMoney(store.accountBalance(doc.accountId))}` : '';
  };
  const payFrom = cfg.payFrom ? accountPicker({
    value: doc.accountId,
    types: cfg.cardOnly ? ['creditCard'] : cfg.bankOnly ? ['bank'] : ['bank', 'creditCard', 'otherCurrentAsset'],
    defaultType: cfg.cardOnly ? 'creditCard' : 'bank',
    ariaLabel: cfg.cardOnly ? '신용카드' : '지출 계정',
    onChange: (v) => { doc.accountId = v; paintBalance(); touch(); },
  }) : null;
  paintBalance();
  const date = dateInput({ value: doc.date, ariaLabel: cfg.dateLabel, required: true, onChange: (v) => {
    doc.date = v;
    if (cfg.terms && doc.terms) { doc.dueDate = dueDateFor(v, doc.terms, store.settings.terms); due.value = doc.dueDate; }
    touch();
  } });
  const method = selectInput({ options: [['', '방법 선택'], ...PAYMENT_METHODS.map((m) => [m, m])], value: doc.paymentMethod || '', ariaLabel: '지불 수단', onChange: (v) => { doc.paymentMethod = v; touch(); } });
  const ref = textInput({ value: cfg.numIsRef || type === 'purchaseOrder' || type === 'bill' ? doc.num || '' : doc.ref || '', ariaLabel: cfg.refLabel });
  ref.addEventListener('input', () => {
    if (cfg.numIsRef || type === 'purchaseOrder' || type === 'bill') doc.num = ref.value.trim();
    else doc.ref = ref.value;
    touch();
  });
  const termsSel = selectInput({ options: [['', '없음'], ...(store.settings.terms || []).map((t) => [t.id, t.name])], value: doc.terms || '', ariaLabel: '지급 조건', onChange: (v) => {
    doc.terms = v || null;
    if (v) { doc.dueDate = dueDateFor(doc.date, v, store.settings.terms); due.value = doc.dueDate; }
    touch();
  } });
  const due = dateInput({ value: doc.dueDate || null, ariaLabel: '기한', onChange: (v) => { doc.dueDate = v; touch(); } });
  const poStatus = selectInput({ options: [['open', '미결'], ['closed', '마감']], value: doc.status || 'open', ariaLabel: '상태', onChange: (v) => { doc.status = v; touch(); } });

  const meta2 = el('div.doc-meta', {},
    payFrom ? el('div', {}, field(cfg.cardOnly ? '신용카드' : '지출 계정', payFrom, { required: true }), payFromBalance) : null,
    field(cfg.dateLabel, date, { required: true }),
    cfg.method ? field('지불 수단', method) : null,
    cfg.terms ? field('지급 조건', termsSel) : null,
    cfg.terms ? field('기한', due) : null,
    field(cfg.refLabel, ref),
    cfg.po ? field('상태', poStatus) : null);

  // ------------------------------------------------------------- lines
  const makeCat = () => ({ accountId: null, desc: '', amount: 0, customerId: null });
  const cats = lineGrid({
    ariaLabel: '분류 내역',
    lines: catLines,
    makeLine: makeCat,
    onChange: () => { touch(); refresh(); },
    columns: [
      { key: 'acct', label: '분류', width: '30%', cell: (line, row) => accountPicker({ value: line.accountId, types: EXPENSE_TYPES, ariaLabel: `분류, ${row.index + 1}행`, onChange: (v) => { line.accountId = v; row.changed(); } }).root },
      {
        key: 'desc', label: '설명',
        cell: (line, row) => {
          const t = el('textarea.input.line-desc', { rows: 1, 'aria-label': `설명, ${row.index + 1}행` });
          t.value = line.desc || '';
          t.addEventListener('input', () => { line.desc = t.value; row.changed(); });
          return t;
        },
      },
      { key: 'amount', label: '금액', width: '130px', align: 'right', cell: (line, row) => moneyInput({ value: line.amount || null, allowNegative: true, ariaLabel: `금액, ${row.index + 1}행`, onChange: (v) => { line.amount = v || 0; row.changed(); } }).root },
      { key: 'cust', label: '고객', width: '20%', cell: (line, row) => contactPicker({ kind: 'customer', value: line.customerId, ariaLabel: `고객, ${row.index + 1}행`, placeholder: '청구 대상', onChange: (v) => { line.customerId = v; row.changed(); } }).root },
    ],
  });

  const makeItem = () => ({ itemId: null, desc: '', qty: '', rate: '', amount: 0 });
  const items = lineGrid({
    ariaLabel: '품목 내역',
    lines: itemLines,
    makeLine: makeItem,
    minRows: 1,
    onChange: () => { touch(); refresh(); },
    columns: [
      {
        key: 'item', label: '품목 또는 서비스', width: '26%',
        cell: (line, row) => {
          const p = itemPicker({ value: line.itemId, purchase: true, ariaLabel: `품목 또는 서비스, ${row.index + 1}행`, onChange: (v) => {
            line.itemId = v;
            const it = store.item(v);
            if (it) {
              line.desc = it.purchaseDesc || it.desc || it.name;
              line.rate = it.cost || 0;
              if (line.qty === '' || line.qty === undefined) line.qty = 1;
              const tr = p.root.closest('tr');
              tr.querySelector('[data-k="desc"]').value = line.desc;
              tr.querySelector('[data-k="qty"]').value = String(line.qty);
              tr.querySelector('[data-k="rate"]').dispatchEvent(new CustomEvent('external', { detail: line.rate }));
            }
            row.changed();
          } });
          return p.root;
        },
      },
      {
        key: 'desc', label: '설명',
        cell: (line, row) => {
          const t = el('textarea.input.line-desc', { rows: 1, 'aria-label': `설명, ${row.index + 1}행`, dataset: { k: 'desc' } });
          t.value = line.desc || '';
          t.addEventListener('input', () => { line.desc = t.value; row.changed(); });
          return t;
        },
      },
      {
        key: 'qty', label: '수량', width: '80px', align: 'right',
        cell: (line, row) => {
          const q = el('input.input.num', { type: 'text', inputMode: 'decimal', 'aria-label': `수량, ${row.index + 1}행`, dataset: { k: 'qty' }, value: line.qty === '' || line.qty === undefined ? '' : String(line.qty) });
          q.addEventListener('input', () => { line.qty = parseQty(q.value); if (line.rate === '') line.rate = 0; row.changed(); });
          return q;
        },
      },
      {
        key: 'rate', label: '단가', width: '110px', align: 'right',
        cell: (line, row) => {
          const m = moneyInput({ value: line.rate === '' ? null : line.rate, ariaLabel: `단가, ${row.index + 1}행`, onChange: (v) => {
            line.rate = v ?? '';
            if (line.qty === '') {
              line.qty = 1;
              const q = m.root.closest('tr')?.querySelector('[data-k="qty"]');
              if (q) q.value = '1';
            }
            row.changed();
          } });
          m.input.dataset.k = 'rate';
          m.input.addEventListener('external', (e) => { m.value = e.detail; });
          return m.root;
        },
      },
      {
        key: 'amount', label: '금액', width: '120px', align: 'right',
        cell: (line) => el('span.money.line-amount', {}, formatMoney(lineTotal(line))),
        refresh: (line, node) => { node.textContent = formatMoney(lineTotal(line)); },
      },
    ],
  });
  const showItems = itemLines.length > 0 || store.itemsList().some((i) => i.purchased);
  const itemSection = el('section.doc-lines', { 'aria-label': '품목 내역' },
    el('h2.doc-section-title', {}, '품목 내역'), items.root);
  const itemToggle = el('button.btn.btn-sm.btn-ghost', { type: 'button', 'aria-expanded': String(showItems) }, '품목 내역');
  itemSection.hidden = !showItems;
  itemToggle.addEventListener('click', () => {
    itemSection.hidden = !itemSection.hidden;
    itemToggle.setAttribute('aria-expanded', String(!itemSection.hidden));
  });

  const totalsBox = el('dl.doc-totals');
  function refresh() {
    const total = [...catLines, ...itemLines].reduce((s, l) => s + lineTotal(l), 0);
    clear(totalsBox);
    totalsBox.append(el('div.tot-row.tot-total', {}, el('dt', {}, '합계'), el('dd.money', {}, formatMoney(total))));
    if (existing && type === 'bill') {
      const open = store.openBalance(doc.id);
      const paid = store.total(existing) - open;
      totalsBox.append(el('div.tot-row', {}, el('dt', {}, '지급 완료'), el('dd.money', {}, formatMoney(paid))));
      totalsBox.append(el('div.tot-row.tot-total', {}, el('dt', {}, '결제 예정 금액'), el('dd.money', {}, formatMoney(total - paid))));
      head.set(total - paid);
    } else head.set(total);
  }

  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: '적요' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });
  const files = attachmentsBlock(doc, touch);

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {},
        field(cfg.payee === 'vendor' ? '공급처' : '지출 수취인', payee, { required: cfg.payee === 'vendor' }),
        type === 'check' || type === 'bill' || type === 'purchaseOrder' ? field('우편 주소', mailing) : null),
      el('div.doc-side', {}, head.node, meta2)),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, '이 거래는 무효 처리되었습니다.')) : null,
    el('section.doc-lines', { 'aria-label': '분류 내역' }, el('h2.doc-section-title', {}, '분류 내역'), cats.root),
    el('div.row', {}, itemToggle),
    itemSection,
    el('div.doc-bottom', {},
      el('div.doc-notes', {}, field('적요', memo), files),
      totalsBox));
  refresh();

  async function save(mode) {
    const record = { ...doc, lines: [...filledLines(catLines), ...filledLines(itemLines)] };
    const saved = store.saveTxn(record);
    dirty = false;
    files.commit();
    toast(`${meta.label} 저장됨`);
    onSaved?.(saved);
    if (doc.poId && type === 'bill') {
      const po = store.txn(doc.poId);
      if (po && po.status !== 'closed') store.saveTxn({ ...po, status: 'closed' }, { allowLocked: true });
    }
    if (mode === 'new') { frame.close(); openPurchaseForm({ type }); }
    else if (mode === 'stay') { frame.close(); openPurchaseForm({ type, id: saved.id }); }
    return true;
  }

  const frame = openFrame({
    title: existing ? `${meta.label}${doc.num ? ` #${doc.num}` : ''}` : meta.label,
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    onSave: save,
    isDirty: () => dirty,
    // Into the item lines when working there, otherwise the categories.
    onAddLine: () => (itemSection.contains(document.activeElement) ? items : cats).addLine(),
    history: recentMenu(type, async (tid) => { if (await frame.requestClose()) openPurchaseForm({ type, id: tid }); }),
    onPrint: type === 'check' || type === 'purchaseOrder' || type === 'bill' ? () => printTxn({ ...doc, lines: [...filledLines(catLines), ...filledLines(itemLines)] }) : null,
    onRecurring: type !== 'purchaseOrder' ? () => openRecurringFromTxn({ ...doc, lines: [...filledLines(catLines), ...filledLines(itemLines)] }) : null,
    more: [
      ...mobileExtras({ onPrint: type === 'check' || type === 'purchaseOrder' || type === 'bill' ? () => printTxn({ ...doc, lines: [...filledLines(catLines), ...filledLines(itemLines)] }) : null, onRecurring: type !== 'purchaseOrder' ? () => openRecurringFromTxn({ ...doc, lines: [...filledLines(catLines), ...filledLines(itemLines)] }) : null }),
      ...txnMoreActions(existing, { reopen: (t) => openPurchaseForm({ type: t.type, id: t.id }), close: () => frame.requestClose() }),
    ],
  });
  return frame;
}
