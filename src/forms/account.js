/** New or edit account dialog, with an opening balance for balance-sheet accounts. */
import { el } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput, checkbox } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES, TYPE_KEYS, isBalanceSheet, typeInfo } from '../lib/accounts.js';
import { today } from '../lib/dates.js';

export function openAccountForm({ account = null, name = '', type = 'expense', types = null } = {}) {
  return new Promise((resolve) => {
    const a = account ? structuredClone(account) : { name, type: types?.includes(type) ? type : types?.[0] || type, number: '', description: '', parentId: null, active: true };
    let saved = null;
    let opening = 0;
    let openingDate = today();
    const nameIn = textInput({ value: a.name });
    nameIn.addEventListener('input', () => { a.name = nameIn.value; });
    const numIn = textInput({ value: a.number || '', inputMode: 'numeric' });
    numIn.addEventListener('input', () => { a.number = numIn.value.trim(); });
    const desc = textArea({ value: a.description || '', rows: 2 });
    desc.addEventListener('input', () => { a.description = desc.value; });
    const allowed = (types || TYPE_KEYS).filter((k) => !(a.role && k !== a.type));
    const typeSel = selectInput({ options: allowed.map((k) => [k, ACCOUNT_TYPES[k].label]), value: a.type, onChange: (v) => { a.type = v; fillParents(); obWrap.hidden = account || !isBalanceSheet(v); } });
    if (a.role) typeSel.disabled = true;
    const parentSel = el('select.select', { 'aria-label': '상위 계정과목' });
    const subBox = checkbox({ checked: !!a.parentId, label: '하위 계정과목으로 설정', onChange: (v) => { parentSel.disabled = !v; if (!v) a.parentId = null; else a.parentId = parentSel.value || null; } });
    parentSel.disabled = !a.parentId;
    parentSel.addEventListener('change', () => { a.parentId = parentSel.value || null; });
    function fillParents() {
      parentSel.replaceChildren();
      const cls = typeInfo(a.type).cls;
      for (const { account: p } of store.chart()) {
        if (p.id === a.id || typeInfo(p.type).cls !== cls) continue;
        parentSel.append(el('option', { value: p.id }, store.accountName(p.id)));
      }
      if (a.parentId) parentSel.value = a.parentId;
      else if (!parentSel.disabled) a.parentId = parentSel.value || null;
    }
    fillParents();
    const ob = moneyInput({ value: null, allowNegative: true, ariaLabel: '기초 잔액', onChange: (v) => { opening = v || 0; } });
    const obDate = dateInput({ value: openingDate, ariaLabel: '기준일', onChange: (v) => { openingDate = v; } });
    const obWrap = el('div.form-grid', { hidden: !!account || !isBalanceSheet(a.type) },
      field('기초 잔액', ob, { hint: '장부를 시작하기 전 이 계정과목에 있던 금액입니다.' }),
      field('기준일', obDate));

    const err = el('p.field-error', { role: 'alert', hidden: true });
    const body = el('div.stack', {},
      err,
      el('div.form-grid', {}, field('계정과목 이름', nameIn, { required: true, className: 'span-2' }), field('계정과목 번호', numIn), field('계정과목 유형', typeSel)),
      el('div', {}, subBox),
      field('상위 계정과목', parentSel),
      field('설명', desc),
      obWrap,
      a.role ? el('p.field-hint', {}, '이 계정과목은 장부에서 사용 중입니다. 이름은 바꿀 수 있지만 유형을 변경하거나 삭제할 수 없습니다.') : null);
    const save = () => {
      try {
        if (opening && !account && store.isLocked(openingDate)) throw new Error(`기초 잔액 날짜가 마감된 기간(${store.settings.closeDate}까지)에 속합니다.`);
        saved = store.saveAccount(a);
        a.id = saved.id;
        if (opening && !account) {
          const sign = typeInfo(saved.type).sign;
          const obe = store.roleAccount('openingBalance');
          store.saveTxn({ type: 'journal', date: openingDate, num: store.nextNumber('journal'), memo: `${saved.name} 기초 잔액`, lines: [
            { accountId: saved.id, debit: sign > 0 ? Math.max(opening, 0) : Math.max(-opening, 0), credit: sign > 0 ? Math.max(-opening, 0) : Math.max(opening, 0), desc: '기초 잔액' },
            { accountId: obe, debit: sign > 0 ? Math.max(-opening, 0) : Math.max(opening, 0), credit: sign > 0 ? Math.max(opening, 0) : Math.max(-opening, 0), desc: '기초 잔액' },
          ] }, { allowLocked: false });
        }
        toast(account ? '계정과목이 저장되었습니다' : '계정과목이 생성되었습니다');
        dlg.close();
      } catch (e) {
        // A new account whose opening balance failed is taken back out, so
        // trying again does not trip over its own name.
        if (!account && saved && !store.accountInUse(saved.id)) { store.remove('accounts', saved.id); delete a.id; saved = null; }
        err.hidden = false;
        err.textContent = e.message;
      }
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const dlg = openDialog({
      title: account ? '계정과목 수정' : '새 계정과목',
      body,
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', { type: 'button', onclick: save }, '저장')),
      initialFocus: nameIn,
      onClose: () => resolve(saved),
    });
  });
}
