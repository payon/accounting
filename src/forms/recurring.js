/** Make recurring: turn a transaction into a schedule. */
import { el } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, selectInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, withoutSnapshots } from '../lib/txn.js';
import { INTERVALS } from '../lib/recurring.js';
import { today, addMonths } from '../lib/dates.js';

export const RECURRING_TYPES = ['invoice', 'expense', 'check', 'bill', 'salesReceipt', 'deposit', 'transfer', 'journal', 'estimate', 'creditMemo', 'vendorCredit', 'ccPayment', 'purchaseOrder', 'refundReceipt', 'ccCredit'];

export function templateOf(doc) {
  // Each occurrence takes the tax rate and item accounts current on its date.
  const t = withoutSnapshots(structuredClone(doc));
  for (const k of ['id', 'num', 'date', 'dueDate', 'createdAt', 'updatedAt', 'attachments', 'applied', 'voided', 'expiryDate', 'status', 'estimateId', 'bankLineId']) delete t[k];
  return t;
}

export function openRecurringForm({ rule = null, doc = null } = {}) {
  return new Promise((resolve) => {
    const r = rule ? structuredClone(rule) : {
      name: doc ? `${TXN_TYPES[doc.type].label}${doc.contactId ? ` (${store.contactName(doc.contactId)})` : ''}` : '',
      type: doc?.type || 'invoice',
      template: doc ? templateOf(doc) : { type: 'invoice', lines: [] },
      interval: 'month', every: 1,
      startDate: addMonths(doc?.date || today(), 1), endDate: null, maxCount: null,
      mode: 'scheduled', daysBefore: 0, active: true, count: 0,
    };
    let saved = null;
    const name = textInput({ value: r.name });
    name.addEventListener('input', () => { r.name = name.value; });
    const mode = selectInput({ options: [['scheduled', '자동 실행: 자동으로 생성합니다'], ['reminder', '알림: 검토하도록 알려 드립니다']], value: r.mode, onChange: (v) => { r.mode = v; } });
    const interval = selectInput({ options: INTERVALS, value: r.interval, onChange: (v) => { r.interval = v; } });
    const every = textInput({ value: String(r.every || 1), inputMode: 'numeric' });
    every.addEventListener('input', () => { r.every = Math.max(1, parseInt(every.value, 10) || 1); });
    const start = dateInput({ value: r.nextDate || r.startDate, required: true, onChange: (v) => { r.startDate = v; r.nextDate = v; } });
    const end = dateInput({ value: r.endDate, onChange: (v) => { r.endDate = v; } });
    const err = el('p.field-error', { role: 'alert', hidden: true });
    const save = () => {
      const fail = (text) => { err.hidden = false; err.textContent = text; };
      if (!r.name.trim()) return fail('템플릿 이름을 입력하세요.');
      // Without a date the template would never run; ending before it starts, likewise.
      const first = r.nextDate || r.startDate;
      if (!first) return fail(rule ? '다음 날짜를 선택하세요.' : '시작 날짜를 선택하세요.');
      if (r.endDate && r.endDate < first) return fail(`종료 날짜가 ${rule ? '다음' : '시작'} 날짜보다 앞입니다.`);
      if (!r.nextDate) r.nextDate = r.startDate;
      saved = store.put('recurring', r);
      toast('반복 거래 템플릿이 저장되었습니다');
      dlg.close();
    };
    const dlg = openDialog({
      title: rule ? '반복 거래 템플릿 수정' : '반복 거래로 설정',
      body: el('div.stack', {}, err,
        field('템플릿 이름', name, { required: true }),
        el('p.field-hint', {}, `유형: ${TXN_TYPES[r.type].label}. 거래의 행, 금액, 이름이 템플릿에 복사됩니다.`),
        field('실행 방식', mode),
        el('div.form-grid', {}, field('간격', interval), field('반복 주기', every, { hint: '예: 2개월마다' }), field(rule ? '다음 날짜' : '시작 날짜', start, { required: true }), field('종료 날짜 (선택 사항)', end))),
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', { type: 'button', onclick: save }, '템플릿 저장')),
      initialFocus: name,
      onClose: () => resolve(saved),
    });
  });
}

export function openRecurringFromTxn(doc) {
  if (!RECURRING_TYPES.includes(doc.type)) {
    toast('이 유형의 거래는 반복 거래로 설정할 수 없습니다.');
    return null;
  }
  return openRecurringForm({ doc });
}
