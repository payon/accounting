/** Product and service form (drawer). */
import { el } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, textArea, moneyInput, checkbox, segmented } from '../ui/fields.js';
import { combobox } from '../ui/combobox.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES } from '../lib/accounts.js';

function acctCombo(value, types, onChange, label) {
  return combobox({
    value, ariaLabel: label, placeholder: '계정과목 선택', onChange,
    labelOf: (id) => store.accountName(id),
    options: () => store.chart().map((r) => r.account).filter((a) => types.includes(a.type)).map((a) => ({ id: a.id, label: store.accountName(a.id), group: ACCOUNT_TYPES[a.type].label })),
  });
}

export function openItemForm({ item = null, name = '' } = {}) {
  return new Promise((resolve) => {
    const it = item ? structuredClone(item) : {
      kind: 'service', name, active: true, taxable: false, sold: true, purchased: false,
      incomeAccountId: store.roleAccount('sales'), expenseAccountId: null,
    };
    let dirty = false;
    let saved = null;
    const touch = () => { dirty = true; };
    const bind = (key, area = false) => {
      const i = area ? textArea({ value: it[key] || '', rows: 2 }) : textInput({ value: it[key] || '' });
      i.addEventListener('input', () => { it[key] = i.value; touch(); });
      return i;
    };
    const kind = segmented({ options: [['service', '서비스'], ['nonInventory', '비재고 품목']], value: it.kind, ariaLabel: '품목 유형', onChange: (v) => { it.kind = v; touch(); } });
    const price = moneyInput({ value: it.price ?? null, ariaLabel: '판매 가격 또는 요율', onChange: (v) => { it.price = v || 0; touch(); } });
    const cost = moneyInput({ value: it.cost ?? null, ariaLabel: '원가', onChange: (v) => { it.cost = v || 0; touch(); } });
    const income = acctCombo(it.incomeAccountId, ['income', 'otherIncome'], (v) => { it.incomeAccountId = v; touch(); }, '수입 계정과목');
    const expense = acctCombo(it.expenseAccountId, ['expense', 'cogs', 'otherExpense', 'otherCurrentAsset', 'fixedAsset'], (v) => { it.expenseAccountId = v; touch(); }, '지출 계정과목');
    const purchasedWrap = el('div.form-grid', { hidden: !it.purchased },
      field('매입 설명', bind('purchaseDesc', true), { className: 'span-2' }),
      field('원가', cost),
      field('지출 계정과목', expense));
    const sold = checkbox({ checked: it.sold !== false, label: '이 품목 또는 서비스를 고객에게 판매합니다', onChange: (v) => { it.sold = v; touch(); } });
    const purchased = checkbox({ checked: !!it.purchased, label: '이 품목 또는 서비스를 공급처에서 매입합니다', onChange: (v) => { it.purchased = v; purchasedWrap.hidden = !v; touch(); } });
    const taxable = checkbox({ checked: !!it.taxable, label: '과세', onChange: (v) => { it.taxable = v; touch(); } });
    const active = checkbox({ checked: it.active !== false, label: '활성', onChange: (v) => { it.active = v; touch(); } });

    const err = el('p.field-error', { role: 'alert', hidden: true });
    const body = el('div.stack', {},
      field('유형', kind),
      el('div.form-grid', {}, field('이름', bind('name'), { required: true, className: 'span-2' }), field('SKU', bind('sku'))),
      el('fieldset.fieldset', {}, el('legend', {}, '판매'),
        el('div', {}, sold),
        el('div.form-grid', {}, field('판매 양식에 표시될 설명', bind('desc', true), { className: 'span-2' }), field('판매 가격 또는 요율', price), field('수입 계정과목', income), el('div.field', {}, taxable))),
      el('fieldset.fieldset', {}, el('legend', {}, '매입'), el('div', {}, purchased), purchasedWrap),
      item ? active : null);
    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, '저장');
    saveBtn.addEventListener('click', () => {
      try {
        saved = store.saveItem(it);
        toast('품목 또는 서비스가 저장되었습니다');
        dirty = false;
        dlg.close();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    });
    const dlg = openDialog({
      title: item ? '품목 또는 서비스 수정' : '새 품목 또는 서비스',
      drawer: true,
      body: [err, body],
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.layer.requestClose() }, '취소'), saveBtn),
      beforeClose: () => (dirty ? confirmDialog({ title: '변경 사항을 버릴까요?', message: '이 품목에 저장하지 않은 변경 사항이 있습니다.', confirmLabel: '버리기', danger: true }) : true),
      onClose: () => resolve(saved),
    });
  });
}
