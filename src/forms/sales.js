/**
 * Sales documents: invoice, estimate, sales receipt, credit memo, refund
 * receipt. One editor, configured per type.
 */
import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput, segmented } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { openFrame } from './frame.js';
import { contactPicker, itemPicker, accountPicker, taxRateSelect, lineGrid, filledLines, attachmentsBlock, headline, recentMenu, parseQty, mobileExtras } from './common.js';
import { store } from '../lib/store.js';
import { newId } from '../lib/ids.js';
import { TXN_TYPES, dueDateFor, PAYMENT_METHODS, lineTotal } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today } from '../lib/dates.js';
import { printTxn } from '../ui/print.js';
import { txnMoreActions } from './actions.js';
import { openRecurringFromTxn } from './recurring.js';

const CONFIG = {
  invoice: { dateLabel: '청구서 날짜', numLabel: '청구서 번호', due: true, headline: '결제 예정 금액' },
  estimate: { dateLabel: '견적서 날짜', numLabel: '견적서 번호', expiry: true, headline: '금액' },
  salesReceipt: { dateLabel: '판매 영수증 날짜', numLabel: '판매 영수증 번호', payment: true, depositTo: true, headline: '금액' },
  creditMemo: { dateLabel: '대변 전표 날짜', numLabel: '대변 전표 번호', headline: '대변 전표 금액' },
  refundReceipt: { dateLabel: '환불 영수증 날짜', numLabel: '환불 번호', payment: true, refundFrom: true, headline: '환불 금액' },
};

function addressText(a) {
  if (!a) return '';
  return [a.line1, a.line2, [a.city, a.state, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n');
}

function billToFor(c) {
  return [c.company || c.displayName, addressText(c.billAddr)].filter(Boolean).join('\n');
}

export function openSalesForm({ type = 'invoice', id = null, draft = null, onSaved = null } = {}) {
  const cfg = CONFIG[type];
  const meta = TXN_TYPES[type];
  const existing = id ? store.txn(id) : null;
  const now = today();
  const doc = existing ? structuredClone(existing) : {
    id: newId(),
    type,
    date: now,
    num: store.nextNumber(type),
    contactId: null,
    terms: store.settings.defaultTerms,
    lines: [],
    taxRateId: store.taxRateList()[0]?.id || null,
    message: type === 'invoice' || type === 'estimate' || type === 'salesReceipt' ? store.settings.invoiceMessage || '' : '',
    memo: '',
    attachments: [],
    ...(type === 'estimate' ? { status: 'pending', expiryDate: null } : {}),
    ...(cfg.depositTo ? { depositToId: store.settings.paymentsToUndeposited ? store.roleAccount('undeposited') : store.accountsOfType('bank')[0]?.id || store.roleAccount('undeposited') } : {}),
    ...(cfg.refundFrom ? { accountId: store.accountsOfType('bank')[0]?.id || null } : {}),
    ...(draft || {}),
  };
  if (!doc.id) doc.id = newId();
  // A customer chosen before the form opened (Create invoice on a customer,
  // converting an estimate) brings what choosing it here would, unless the
  // draft says otherwise.
  if (!existing && draft?.contactId) {
    const c = store.contact(draft.contactId);
    if (c) {
      if (draft.email === undefined) doc.email = c.email || '';
      if (draft.billTo === undefined) doc.billTo = billToFor(c);
      if (type === 'invoice' && c.terms && draft.terms === undefined) doc.terms = c.terms;
      if (c.taxable === false && draft.taxRateId === undefined) doc.taxRateId = null;
    }
  }
  if (type === 'invoice' && !doc.dueDate) doc.dueDate = dueDateFor(doc.date, doc.terms, store.settings.terms);
  doc.lines = (doc.lines || []).map((l) => ({ ...l }));
  let dirty = !!draft;
  const touch = () => { dirty = true; };

  const head = headline(cfg.headline);

  // ------------------------------------------------------- customer area
  const email = textInput({ value: doc.email || '', type: 'email', ariaLabel: '고객 이메일' });
  email.addEventListener('input', () => { doc.email = email.value; touch(); });
  const billTo = textArea({ value: doc.billTo || '', rows: 4, ariaLabel: '청구지 주소' });
  billTo.addEventListener('input', () => { doc.billTo = billTo.value; touch(); });
  const customer = contactPicker({
    kind: 'customer', value: doc.contactId, ariaLabel: '고객',
    onChange: (v) => {
      const prev = store.contact(doc.contactId);
      doc.contactId = v;
      touch();
      const c = store.contact(v);
      if (c) {
        // The email and terms follow the customer, unless typed or chosen here.
        if (!doc.email || doc.email === (prev?.email || '')) { doc.email = c.email || ''; email.value = doc.email; }
        doc.billTo = billToFor(c);
        billTo.value = doc.billTo;
        const terms = c.terms || (prev?.terms && doc.terms === prev.terms ? store.settings.defaultTerms : null);
        if (terms && type === 'invoice') { doc.terms = terms; termsSel.value = terms; doc.dueDate = dueDateFor(doc.date, doc.terms, store.settings.terms); due.value = doc.dueDate; }
        if (c.taxable === false) { doc.taxRateId = null; taxSel.value = ''; }
      }
      paintBalance();
      refresh();
    },
  });
  const custBalance = el('div.field-hint');
  function paintBalance() {
    const bal = doc.contactId ? store.contactBalances('customer').get(doc.contactId) || 0 : 0;
    custBalance.textContent = doc.contactId && bal ? `미결 잔액 ${formatMoney(bal)}` : '';
  }
  paintBalance();

  // -------------------------------------------------------------- meta
  const numIn = textInput({ value: doc.num || '', ariaLabel: cfg.numLabel });
  numIn.addEventListener('input', () => { doc.num = numIn.value.trim(); touch(); });
  const date = dateInput({ value: doc.date, ariaLabel: cfg.dateLabel, required: true, onChange: (v) => {
    doc.date = v;
    if (type === 'invoice' && doc.terms) { doc.dueDate = dueDateFor(v, doc.terms, store.settings.terms); due.value = doc.dueDate; }
    touch();
  } });
  const termsSel = selectInput({ options: [['', '없음'], ...(store.settings.terms || []).map((t) => [t.id, t.name])], value: doc.terms || '', ariaLabel: '지급 조건', onChange: (v) => {
    doc.terms = v || null;
    if (v) { doc.dueDate = dueDateFor(doc.date, v, store.settings.terms); due.value = doc.dueDate; }
    touch();
  } });
  const due = dateInput({ value: doc.dueDate || null, ariaLabel: '기한', onChange: (v) => { doc.dueDate = v; touch(); } });
  const expiry = dateInput({ value: doc.expiryDate || null, ariaLabel: '만료일', onChange: (v) => { doc.expiryDate = v; touch(); } });
  // Converted is set by converting, not chosen, so it is listed only when it applies.
  const statusSel = selectInput({ options: [['pending', '보류'], ['accepted', '승인됨'], ['rejected', '거절됨'], ['closed', '마감'], ...(doc.status === 'converted' ? [['converted', '변환됨']] : [])], value: doc.status || 'pending', ariaLabel: '상태', onChange: (v) => { doc.status = v; touch(); } });
  const method = selectInput({ options: [['', '방법 선택'], ...PAYMENT_METHODS.map((m) => [m, m])], value: doc.paymentMethod || '', ariaLabel: '지불 수단', onChange: (v) => { doc.paymentMethod = v; touch(); } });
  const refNo = textInput({ value: doc.ref || '', ariaLabel: '참조 번호' });
  refNo.addEventListener('input', () => { doc.ref = refNo.value; touch(); });
  const depositTo = cfg.depositTo ? accountPicker({ value: doc.depositToId, types: ['bank', 'otherCurrentAsset', 'creditCard'], ariaLabel: '입금 계정', onChange: (v) => { doc.depositToId = v; touch(); } }) : null;
  const refundFrom = cfg.refundFrom ? accountPicker({ value: doc.accountId, types: ['bank', 'creditCard', 'otherCurrentAsset'], ariaLabel: '환불 계정', onChange: (v) => { doc.accountId = v; touch(); } }) : null;

  const metaGrid = el('div.doc-meta', {},
    field(cfg.numLabel, numIn),
    cfg.due ? field('지급 조건', termsSel) : null,
    field(cfg.dateLabel, date, { required: true }),
    cfg.due ? field('기한', due) : null,
    cfg.expiry ? field('만료일', expiry) : null,
    type === 'estimate' ? field('상태', statusSel) : null,
    cfg.payment ? field('지불 수단', method) : null,
    cfg.payment ? field('참조 번호', refNo) : null,
    depositTo ? field('입금 계정', depositTo) : null,
    refundFrom ? field('환불 계정', refundFrom) : null);

  // ------------------------------------------------------------- lines
  const makeLine = () => ({ itemId: null, desc: '', qty: '', rate: '', amount: 0, taxable: false });
  const grid = lineGrid({
    ariaLabel: '품목 또는 서비스',
    lines: doc.lines,
    makeLine,
    onChange: () => { touch(); refresh(); },
    columns: [
      {
        key: 'item', label: '품목 또는 서비스', width: '24%',
        cell: (line, row) => {
          const p = itemPicker({ value: line.itemId, ariaLabel: `품목 또는 서비스, ${row.index + 1}행`, onChange: (v) => {
            line.itemId = v;
            const it = store.item(v);
            if (it) {
              line.desc = it.desc || it.name;
              line.rate = it.price || 0;
              if (line.qty === '' || line.qty === null || line.qty === undefined) line.qty = 1;
              line.taxable = !!it.taxable;
              const tr = p.root.closest('tr');
              tr.querySelector('[data-k="desc"]').value = line.desc;
              tr.querySelector('[data-k="qty"]').value = String(line.qty);
              tr.querySelector('[data-k="rate"]').dispatchEvent(new CustomEvent('external', { detail: line.rate }));
              tr.querySelector('[data-k="tax"]').checked = line.taxable;
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
          // A quantity typed for an amount entered on its own keeps the
          // amount: the rate follows from it.
          let fromAmount = null;
          q.addEventListener('focus', () => {
            const none = (x) => x === '' || x === undefined || x === null;
            fromAmount = none(line.qty) && none(line.rate) && line.amount ? line.amount : null;
          });
          q.addEventListener('input', () => {
            const n = parseQty(q.value);
            line.qty = Number.isFinite(n) ? n : '';
            if (fromAmount !== null) {
              line.rate = line.qty ? fromAmount / line.qty : '';
              q.closest('tr')?.querySelector('[data-k="rate"]')?.dispatchEvent(new CustomEvent('external', { detail: line.rate === '' ? null : line.rate }));
            } else if (line.qty !== '' && (line.rate === '' || line.rate === undefined)) line.rate = 0;
            row.changed();
          });
          return q;
        },
      },
      {
        key: 'rate', label: '요율', width: '110px', align: 'right',
        cell: (line, row) => {
          const m = moneyInput({ value: line.rate === '' ? null : line.rate, ariaLabel: `요율, ${row.index + 1}행`, onChange: (v) => {
            line.rate = v ?? '';
            if (line.rate !== '' && (line.qty === '' || line.qty === undefined)) {
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
        cell: (line, row) => {
          const m = moneyInput({ value: lineTotal(line) || null, allowNegative: true, ariaLabel: `금액, ${row.index + 1}행`, onChange: (v) => {
            // Typing an amount sets the rate from the quantity (or clears both).
            const q = Number(line.qty);
            if (q) line.rate = (v || 0) / q;
            else { line.qty = ''; line.rate = ''; line.amount = v || 0; }
            const tr = m.root.closest('tr');
            tr?.querySelector('[data-k="rate"]')?.dispatchEvent(new CustomEvent('external', { detail: line.rate === '' ? null : line.rate }));
            row.changed();
          } });
          m.input.dataset.k = 'amount';
          m.input.addEventListener('external', (e) => { m.value = e.detail; });
          return m.root;
        },
        refresh: (line, node) => {
          if (document.activeElement !== node) node.dispatchEvent(new CustomEvent('external', { detail: lineTotal(line) || null }));
        },
      },
      {
        key: 'tax', label: '세금', width: '52px',
        cell: (line, row) => {
          const c = el('input', { type: 'checkbox', checked: !!line.taxable, 'aria-label': `과세, ${row.index + 1}행`, dataset: { k: 'tax' } });
          c.addEventListener('change', () => { line.taxable = c.checked; row.changed(); });
          return c;
        },
      },
    ],
  });

  // ------------------------------------------------------------ totals
  const totalsBox = el('dl.doc-totals');
  const taxSel = taxRateSelect({ value: doc.taxRateId, bp: doc.taxRateBp, onChange: (v) => { doc.taxRateId = v; doc.taxOverride = null; doc.taxRateBp = null; touch(); refresh(); } });
  const discType = segmented({ options: [['pct', '%'], ['amt', '$']], value: doc.discountType || 'pct', ariaLabel: '할인 유형', onChange: (v) => { doc.discountType = v; doc.discountValue = 0; discValue.value = null; touch(); refresh(); } });
  const discValue = moneyInput({ value: doc.discountType === 'pct' ? doc.discountValue || null : doc.discountValue || null, ariaLabel: '할인 값', onChange: (v) => { doc.discountType = doc.discountType || 'pct'; doc.discountValue = v || 0; touch(); refresh(); } });

  // The rows are built once and only their amounts change, so typing in the
  // discount box or arrowing through tax rates never loses focus.
  const amt = () => el('dd.money');
  const totalRow = (label, value, cls = '') => el(`div.tot-row${cls}`, {}, el('dt', {}, label), value);
  const vSubtotal = amt(); const vDiscount = amt(); const vTaxable = amt(); const vTax = amt(); const vTotal = amt(); const vReceived = amt(); const vDue = amt();
  const taxableRow = totalRow('과세 소계', vTaxable);
  const showReceived = existing && type === 'invoice';
  // What was received is fixed while editing: the saved total less its saved open balance.
  const received = showReceived ? store.total(existing) - store.openBalance(existing.id) : 0;
  totalsBox.append(
    totalRow('소계', vSubtotal),
    el('div.tot-row.tot-control', {}, el('dt', {}, '할인', discType.root, discValue.root), vDiscount),
    taxableRow,
    el('div.tot-row.tot-control', {}, el('dt', {}, '판매세', taxSel), vTax),
    totalRow('합계', vTotal, '.tot-total'));
  if (showReceived) totalsBox.append(totalRow('수납 금액', vReceived), totalRow('결제 예정 금액', vDue, '.tot-total'));

  function refresh() {
    const t = store.salesTotals(doc);
    vSubtotal.textContent = formatMoney(t.subtotal);
    vDiscount.textContent = t.discount ? `-${formatMoney(t.discount)}` : formatMoney(0);
    taxableRow.hidden = !(t.taxableBase && doc.taxRateId);
    vTaxable.textContent = formatMoney(t.taxableBase);
    vTax.textContent = formatMoney(t.tax);
    vTotal.textContent = formatMoney(t.total);
    if (showReceived) {
      vReceived.textContent = formatMoney(received);
      vDue.textContent = formatMoney(t.total - received);
      head.set(t.total - received);
    } else head.set(t.total);
  }
  // A percentage discount is stored in basis points (10% = 1000); the money
  // input yields hundredths, so typing 10 means 10% as it should.

  // -------------------------------------------------------------- notes
  const message = textArea({ value: doc.message || '', rows: 3, ariaLabel: type === 'estimate' ? '견적서 메시지' : '청구서 메시지' });
  message.addEventListener('input', () => { doc.message = message.value; touch(); });
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: '거래명세서 적요' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const linked = existing ? linkedInfo(doc) : null;
  const attachments = attachmentsBlock(doc, touch);

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {},
        field('고객', customer, { required: type !== 'salesReceipt' && type !== 'refundReceipt' }),
        custBalance,
        field('고객 이메일', email),
        field('청구지', billTo)),
      el('div.doc-side', {}, head.node, metaGrid)),
    linked,
    el('section.doc-lines', { 'aria-label': '품목 행' }, el('h2.doc-section-title', {}, '품목 또는 서비스'), grid.root),
    el('div.doc-bottom', {},
      el('div.doc-notes', {},
        field(type === 'estimate' ? '견적서 메시지' : type === 'invoice' ? '청구서 메시지' : '영수증에 표시될 메시지', message),
        field('거래명세서 적요 (표시되지 않음)', memo),
        attachments),
      totalsBox));

  refresh();

  async function save(mode) {
    const record = { ...doc, lines: filledLines(doc.lines) };
    if (!record.num) record.num = store.nextNumber(type);
    const saved = store.saveTxn(record);
    dirty = false;
    attachments.commit();
    // An invoice made from an estimate closes the estimate only once it exists.
    if (!existing && saved.type === 'invoice' && saved.estimateId) {
      const est = store.txn(saved.estimateId);
      if (est && est.status !== 'converted') store.saveTxn({ ...est, status: 'converted' }, { allowLocked: true });
    }
    toast(`${meta.label} ${saved.num ? `#${saved.num} ` : ''}저장됨`, { action: { label: '인쇄', onClick: () => printTxn(saved) } });
    onSaved?.(saved);
    if (mode === 'new') {
      frame.close();
      openSalesForm({ type });
    } else if (mode === 'stay') {
      frame.close();
      openSalesForm({ type, id: saved.id });
    }
    return true;
  }

  const frame = openFrame({
    title: existing ? `${meta.label} #${doc.num || ''}`.trim() : meta.label,
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    onSave: save,
    isDirty: () => dirty,
    onAddLine: () => grid.addLine(),
    history: recentMenu(type, async (tid) => { if (await frame.requestClose()) openSalesForm({ type, id: tid }); }),
    onPrint: () => printTxn({ ...doc, lines: filledLines(doc.lines) }),
    onRecurring: () => openRecurringFromTxn({ ...doc, lines: filledLines(doc.lines) }),
    more: [
      ...mobileExtras({ onPrint: () => printTxn({ ...doc, lines: filledLines(doc.lines) }), onRecurring: () => openRecurringFromTxn({ ...doc, lines: filledLines(doc.lines) }) }),
      ...(type === 'invoice' || type === 'estimate' || type === 'salesReceipt' || type === 'creditMemo' ? [{ label: '고객에게 이메일 보내기', icon: 'mail', onClick: () => emailDoc({ ...doc, lines: filledLines(doc.lines) }) }, 'sep'] : []),
      ...txnMoreActions(existing, { reopen: (t) => openSalesForm({ type: t.type, id: t.id }), close: () => frame.requestClose() }),
    ],
  });
  return frame;
}

/**
 * Hand the document to the user's own mail app: the customer's address, a
 * subject, and a plain-text summary they can edit before sending. Nothing is
 * sent from here.
 */
export function emailDoc(t) {
  const meta = TXN_TYPES[t.type];
  const company = store.settings.company?.name || '';
  const totals = store.salesTotals(t);
  const open = store.txn(t.id) && t.type === 'invoice' ? store.openBalance(t.id) : totals.total;
  const lines = (t.lines || []).map((l) => `- ${l.desc || store.item(l.itemId)?.name || '품목'}: ${formatMoney(lineTotal(l))}`);
  const body = [
    `${store.contactName(t.contactId) || ''}님, 안녕하세요.`.trim(),
    '',
    `${company}${t.num ? ` ${meta.label} #${t.num}` : ''} 문서입니다.`,
    '',
    ...lines,
    '',
    `합계: ${formatMoney(totals.total)}`,
    t.type === 'invoice' ? `결제 예정 금액: ${formatMoney(open)}${t.dueDate ? ` (기한 ${t.dueDate})` : ''}` : null,
    '',
    t.message || '',
    '',
    company,
  ].filter((x) => x !== null).join('\n');
  const subject = `${company} ${meta.label}${t.num ? ` #${t.num}` : ''}`.trim();
  const to = t.email || store.contact(t.contactId)?.email || '';
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Payments, credits, and the estimate an invoice came from. */
function linkedInfo(doc) {
  const links = store.docInfo().links.get(doc.id) || [];
  const items = [];
  for (const l of links) {
    const t = store.txn(l.txnId);
    if (!t) continue;
    items.push(el('li', {}, el('a', { href: `#/txn/${t.id}` }, `${TXN_TYPES[t.type].label} ${t.num ? `#${t.num} ` : ''} (${t.date})`), `에 ${formatMoney(l.amount)} 적용됨`));
  }
  if (doc.estimateId) {
    const est = store.txn(doc.estimateId);
    if (est) items.push(el('li', {}, '다음에서 생성됨: ', el('a', { href: `#/txn/${est.id}` }, `견적서 #${est.num || ''}`)));
  }
  if (doc.type === 'estimate') {
    for (const t of store.txns.values()) if (t.estimateId === doc.id) items.push(el('li', {}, '다음으로 변환됨: ', el('a', { href: `#/txn/${t.id}` }, `청구서 #${t.num || ''}`)));
  }
  if (doc.voided) items.unshift(el('li', {}, el('strong', {}, '이 거래는 무효 처리되었습니다.')));
  if (!items.length) return null;
  return el('div.banner.banner-info.doc-links', {}, el('span', { html: icon('link', 18) }), el('ul', {}, items));
}

export async function convertEstimate(est) {
  if (!est) return;
  const ok = est.status === 'converted' ? await confirmDialog({ title: '다시 변환할까요?', message: '이 견적서는 이미 청구서로 변환되었습니다. 하나 더 생성할까요?', confirmLabel: '청구서 생성' }) : true;
  if (!ok) return;
  const draft = {
    contactId: est.contactId, email: est.email, billTo: est.billTo, lines: structuredClone(est.lines || []),
    taxRateId: est.taxRateId, discountType: est.discountType, discountValue: est.discountValue, estimateId: est.id,
    message: store.settings.invoiceMessage || '',
  };
  openSalesForm({ type: 'invoice', draft });
}
