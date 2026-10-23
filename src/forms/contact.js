/** Customer and vendor forms: a full drawer, and a quick-add dialog for pickers. */
import { el } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, textArea, selectInput, checkbox, segmented } from '../ui/fields.js';
import { combobox } from '../ui/combobox.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES } from '../lib/accounts.js';

function addressFields(addr, label) {
  const a = addr || {};
  const f = (k, l, opts = {}) => {
    const i = textInput({ value: a[k] || '', autocomplete: opts.ac || 'off' });
    i.addEventListener('input', () => { a[k] = i.value; });
    return field(l, i, { className: opts.span ? 'span-2' : '' });
  };
  return {
    value: a,
    node: el('fieldset.fieldset', {}, el('legend', {}, label),
      el('div.form-grid', {}, f('line1', '상세 주소', { span: true, ac: 'address-line1' }), f('line2', '주소 추가 항목', { span: true, ac: 'address-line2' }), f('city', '도시', { ac: 'address-level2' }), f('state', '시/도 또는 지역', { ac: 'address-level1' }), f('zip', '우편번호', { ac: 'postal-code' }), f('country', '국가', { ac: 'country-name' }))),
  };
}

/**
 * Open the full customer or vendor drawer. Resolves to the saved contact, or
 * null if cancelled.
 */
export function openContactForm({ kind = 'customer', contact = null, name = '' } = {}) {
  return new Promise((resolve) => {
    const c = contact ? structuredClone(contact) : { kind, displayName: name, active: true, terms: store.settings.defaultTerms };
    let dirty = false;
    let saved = null;
    const touch = () => { dirty = true; };
    const bind = (key, opts = {}) => {
      const i = opts.area ? textArea({ value: c[key] || '', rows: 3 }) : textInput({ value: c[key] || '', type: opts.type || 'text', autocomplete: opts.ac || 'off', inputMode: opts.inputMode });
      i.addEventListener('input', () => { c[key] = i.value; touch(); if (opts.after) opts.after(); });
      return i;
    };
    const display = bind('displayName');
    const suggest = () => {
      if (c._displayEdited) return;
      const auto = c.company || [c.firstName, c.lastName].filter(Boolean).join(' ');
      if (auto) { c.displayName = auto; display.value = auto; }
    };
    display.addEventListener('input', () => { c._displayEdited = true; });
    if (contact) c._displayEdited = true;
    const bill = addressFields(c.billAddr || (c.billAddr = {}), '청구지 주소');
    const ship = addressFields(c.shipAddr || (c.shipAddr = {}), '배송지 주소');
    const sameBox = checkbox({ checked: c.shipSame !== false, label: '청구지 주소와 동일', onChange: (v) => { c.shipSame = v; ship.node.hidden = v; touch(); } });
    ship.node.hidden = c.shipSame !== false;

    const terms = selectInput({ options: [['', '없음'], ...(store.settings.terms || []).map((t) => [t.id, t.name])], value: c.terms || '', onChange: (v) => { c.terms = v || null; touch(); } });
    const kindToggle = segmented({ options: [['customer', '고객'], ['vendor', '공급처']], value: c.kind, ariaLabel: '유형', onChange: (v) => { c.kind = v; touch(); renderKind(); } });
    const defaultAcct = combobox({
      value: c.defaultAccountId || null,
      placeholder: '분류 선택',
      ariaLabel: '기본 지출 분류',
      labelOf: (id) => store.accountName(id),
      options: () => store.chart().map((r) => r.account).filter((a) => ['expense', 'cogs', 'otherExpense', 'fixedAsset', 'otherCurrentAsset'].includes(a.type)).map((a) => ({ id: a.id, label: store.accountName(a.id), group: ACCOUNT_TYPES[a.type].label })),
      onChange: (v) => { c.defaultAccountId = v; touch(); },
    });
    const taxable = checkbox({ checked: c.taxable !== false, label: '이 고객은 과세 대상입니다', onChange: (v) => { c.taxable = v; touch(); } });
    const kindExtras = el('div.form-grid');
    function renderKind() {
      kindExtras.replaceChildren();
      if (c.kind === 'vendor') {
        kindExtras.append(field('기본 분류', defaultAcct, { hint: '이 공급처의 신규 지출과 매입채무가 이 분류로 시작합니다.' }), field('사업자 번호 또는 세금 ID', bind('taxId')), field('계정 번호', bind('accountNo'), { hint: '이 공급처에서 사용하는 귀하의 계정 번호' }));
      } else {
        kindExtras.append(el('div.field.span-2', {}, taxable));
      }
    }
    renderKind();
    const active = checkbox({ checked: c.active !== false, label: '활성', onChange: (v) => { c.active = v; touch(); } });

    const body = el('div.stack', {},
      contact ? null : field('유형', kindToggle),
      el('fieldset.fieldset', {}, el('legend', {}, '이름 및 연락처'),
        el('div.form-grid', {},
          field('이름', bind('firstName', { ac: 'given-name', after: suggest })),
          field('성', bind('lastName', { ac: 'family-name', after: suggest })),
          field('회사 이름', bind('company', { ac: 'organization', after: suggest }), { className: 'span-2' }),
          field('표시 이름', display, { required: true, className: 'span-2', hint: '거래와 목록에 표시될 이름입니다.' }),
          field('이메일', bind('email', { type: 'email', ac: 'email' })),
          field('전화', bind('phone', { type: 'tel', ac: 'tel' })),
          field('휴대폰', bind('mobile', { type: 'tel' })),
          field('웹사이트', bind('website', { type: 'url', ac: 'url' })))),
      bill.node,
      el('div', {}, sameBox),
      ship.node,
      el('fieldset.fieldset', {}, el('legend', {}, '영수/지출'), el('div.form-grid', {}, field('지급 조건', terms)), kindExtras),
      el('fieldset.fieldset', {}, el('legend', {}, '메모'), field('메모', bind('notes', { area: true }))),
      contact ? active : null);

    const err = el('p.field-error', { role: 'alert', hidden: true });
    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, '저장');
    saveBtn.addEventListener('click', () => {
      try {
        const rec = { ...c };
        delete rec._displayEdited;
        saved = store.saveContact(rec);
        toast(`${saved.kind === 'vendor' ? '공급처' : '고객'}이 저장되었습니다`);
        dirty = false;
        dlg.close();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    });
    const dlg = openDialog({
      title: contact ? `${c.kind === 'vendor' ? '공급처' : '고객'} 수정` : `새 ${c.kind === 'vendor' ? '공급처' : '고객'}`,
      drawer: true,
      body: [err, body],
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.layer.requestClose() }, '취소'), saveBtn),
      beforeClose: async () => {
        if (!dirty) return true;
        const { confirmDialog } = await import('../ui/dialog.js');
        return confirmDialog({ title: '변경 사항을 버릴까요?', message: '이 거래처에 저장하지 않은 변경 사항이 있습니다.', confirmLabel: '버리기', danger: true });
      },
      onClose: () => resolve(saved),
    });
  });
}

/** A small "add new" dialog used from pickers. */
export function quickContact(kind, name) {
  return new Promise((resolve) => {
    let saved = null;
    let handedOff = false;
    const input = textInput({ value: name || '' });
    const err = el('p.field-error', { role: 'alert', hidden: true });
    const save = () => {
      try {
        saved = store.saveContact({ kind, displayName: input.value.trim(), terms: store.settings.defaultTerms });
        dlg.close();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const dlg = openDialog({
      title: `새 ${kind === 'vendor' ? '공급처' : '고객'}`,
      body: [field(kind === 'vendor' ? '공급처 표시 이름' : '고객 표시 이름', input, { required: true }), err],
      footer: [
        el('button.btn.btn-ghost', { type: 'button', onclick: () => { handedOff = true; dlg.close(); openContactForm({ kind, name: input.value }).then(resolve); } }, '상세 정보 추가'),
        el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', { type: 'button', onclick: save }, '저장')),
      ],
      initialFocus: input,
      onClose: () => { if (!handedOff) resolve(saved); },
    });
  });
}
