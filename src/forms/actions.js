/**
 * The "More" menu on a saved transaction: duplicate, void, delete, journal,
 * and follow-ups. `close()` closes the form, asking first about unsaved
 * changes, and resolves false when the user stays.
 */
import { el } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { TXN_TYPES } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';

async function forms() {
  return import('./index.js');
}

export function txnMoreActions(existing, { reopen, close } = {}) {
  if (!existing) return [];
  const t = existing;
  const meta = TXN_TYPES[t.type];
  const items = [];
  const leave = async () => (close ? (await close()) !== false : true);
  if (t.type === 'estimate') {
    items.push({ label: '청구서로 변환', icon: 'invoice', onClick: async () => { if (!(await leave())) return; (await import('./sales.js')).convertEstimate(store.txn(t.id)); } });
  }
  if (t.type === 'invoice' && store.openBalance(t.id) > 0) {
    items.push({ label: '영수 기록', icon: 'handCoins', onClick: async () => { if (!(await leave())) return; (await forms()).openTxnForm({ type: 'payment', draft: { contactId: t.contactId, preselect: t.id } }); } });
  }
  if (t.type === 'bill' && store.openBalance(t.id) > 0) {
    items.push({ label: '이 매입채무 지급', icon: 'wallet', onClick: async () => { if (!(await leave())) return; (await forms()).openTxnForm({ type: 'billPayment', draft: { contactId: t.contactId, preselect: t.id } }); } });
  }
  if (t.type === 'purchaseOrder') {
    items.push({ label: '매입채무로 복사', icon: 'receipt', onClick: async () => { if (!(await leave())) return; (await forms()).openTxnForm({ type: 'bill', draft: { contactId: t.contactId, lines: structuredClone(t.lines || []), poId: t.id, memo: `발주서 #${t.num || ''}에서` } }); } });
  }
  items.push({ label: '복제', icon: 'copy', onClick: async () => {
    if (!(await leave())) return;
    const copy = store.duplicateTxn(t.id);
    (await forms()).openTxnForm({ type: t.type, draft: copy });
  } });
  if (!meta.nonPosting) items.push({ label: '거래 분개', icon: 'journal', onClick: () => showJournal(store.txn(t.id)) });
  items.push('sep');
  if (!meta.nonPosting && !t.voided) {
    items.push({ label: '무효 처리', icon: 'ban', onClick: async () => {
      const ok = await confirmDialog({ title: `이 ${meta.label.toLowerCase()}을(를) 무효 처리할까요?`, message: '금액은 0이 되지만 번호를 유지한 채 기록에 남습니다. 적용된 영수/지출은 적용이 취소됩니다.', confirmLabel: '무효 처리', danger: true });
      if (!ok) return null;
      try {
        store.voidTxn(t.id);
        toast(`${meta.label} 무효 처리됨`);
        return 'close';
      } catch (err) { toastError(err); return null; }
    } });
  }
  items.push({ label: '삭제', icon: 'trash', danger: true, onClick: async () => {
    const ok = await confirmDialog({ title: `이 ${meta.label.toLowerCase()}을(를) 삭제할까요?`, message: '장부에서 삭제됩니다. 이 항목을 참조하는 영수나 입금은 조정됩니다.', confirmLabel: '삭제', danger: true });
    if (!ok) return null;
    try {
      const before = store.deleteTxn(t.id);
      toast(`${meta.label} 삭제됨`, { action: { label: '실행 취소', onClick: () => { store.restore(before); reopen?.(before.txns[0]); } } });
      return 'close';
    } catch (err) { toastError(err); return null; }
  } });
  return items;
}

export function showJournal(t) {
  if (!t) return;
  const ps = store.ledgerPostingsOf(t);
  let d = 0; let c = 0;
  const rows = ps.map((p) => {
    if (p.amount > 0) d += p.amount; else c -= p.amount;
    return el('tr', {},
      el('td', {}, store.accountName(p.accountId)),
      el('td', {}, store.contactName(p.contactId) || ''),
      el('td', {}, p.memo || ''),
      el('td.num', {}, p.amount > 0 ? formatMoney(p.amount) : ''),
      el('td.num', {}, p.amount < 0 ? formatMoney(-p.amount) : ''));
  });
  openDialog({
    title: '거래 분개',
    wide: true,
    body: el('div.table-wrap', {}, el('table.grid', {},
      el('caption.sr-only', {}, '이 거래의 차변과 대변'),
      el('thead', {}, el('tr', {}, ['계정과목', '이름', '적요'].map((h) => el('th', { scope: 'col' }, h)), el('th.num', { scope: 'col' }, '차변'), el('th.num', { scope: 'col' }, '대변'))),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {}, el('td', { colSpan: 3 }, '합계'), el('td.num', {}, formatMoney(d)), el('td.num', {}, formatMoney(c)))))),
  });
}
