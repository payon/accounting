/** Bank rules: categorize statement lines automatically. */
import { el, clear, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, selectInput, moneyInput, checkbox } from '../ui/fields.js';
import { dataTable } from '../ui/table.js';
import { toast } from '../ui/toast.js';
import { pageHead, emptyState } from './page.js';
import { accountPicker, contactPicker } from '../forms/common.js';
import { store } from '../lib/store.js';
import { RULE_OPS, ruleMatches } from '../lib/banking.js';
import { formatMoney } from '../lib/money.js';

function describe(rule) {
  const parts = (rule.conditions || []).map((c) => {
    const op = (RULE_OPS[c.field] || []).find((o) => o[0] === c.op)?.[1] || c.op;
    return `${c.field === 'amount' ? '금액' : '내용'} ${op} ${c.field === 'amount' ? formatMoney(c.value || 0) : `"${c.value}"`}`;
  });
  return parts.join(rule.match === 'any' ? ' 또는 ' : ' 그리고 ');
}

export function renderRules(main) {
  const rows = [...store.rules.values()].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name));
  const reviewLines = [...store.bankLines.values()].filter((l) => l.status === 'review');
  const columns = [
    { key: 'priority', label: '우선순위', render: (r) => String(rows.indexOf(r) + 1), sortable: false },
    { key: 'name', label: '규칙 이름', primary: true, render: (r) => el('span.cell-main', {}, r.name), sortable: false },
    { key: 'applies', label: '적용 대상', hideMobile: true, render: (r) => (r.direction === 'out' ? '지출' : r.direction === 'in' ? '수입' : '수입 또는 지출'), sortable: false },
    { key: 'cond', label: '조건', render: (r) => describe(r), sortable: false },
    { key: 'set', label: '설정', hideMobile: true, render: (r) => [r.set?.transferAccountId ? `이체: ${store.accountName(r.set.transferAccountId)}` : r.set?.categoryId ? `카테고리: ${store.accountName(r.set.categoryId)}` : '', r.set?.contactId ? ` · 거래처: ${store.contactName(r.set.contactId)}` : ''].join(''), sortable: false },
    { key: 'hits', label: '현재 일치', align: 'right', render: (r) => String(reviewLines.filter((l) => ruleMatches(r, l)).length), sortable: false },
    { key: 'status', label: '상태', render: (r) => el(`span.badge${r.active === false ? '' : '.badge-positive'}`, {}, r.active === false ? '비활성' : r.autoAdd ? '자동 추가' : '활성'), sortable: false },
    {
      key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false,
      render: (r) => el('div.row', { style: { justifyContent: 'flex-end' } },
        el('button.icon-btn', { type: 'button', 'aria-label': `${r.name} 위로 이동`, html: icon('up', 16), disabled: rows.indexOf(r) === 0, onclick: () => move(r, -1) }),
        el('button.icon-btn', { type: 'button', 'aria-label': `${r.name} 아래로 이동`, html: icon('down', 16), disabled: rows.indexOf(r) === rows.length - 1, onclick: () => move(r, 1) }),
        el('button.icon-btn', { type: 'button', 'aria-label': `${r.name} 삭제`, html: icon('trash', 16), onclick: async () => { if (await confirmDialog({ title: `규칙 ${r.name}을(를) 삭제하시겠습니까?`, message: '이 규칙으로 이미 분류된 거래는 바뀌지 않습니다.', confirmLabel: '삭제', danger: true })) { store.remove('rules', r.id); toast('규칙이 삭제되었습니다'); } } })),
    },
  ];
  function move(r, dir) {
    const i = rows.indexOf(r);
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const order = rows.slice();
    [order[i], order[j]] = [order[j], order[i]];
    store.batch(({ put }) => order.forEach((x, k) => put('rules', { ...x, priority: k })));
  }
  const table = dataTable({
    columns, rows, ariaLabel: '은행 규칙', onRowClick: (r) => openRuleForm({ rule: r }),
    empty: emptyState({ iconName: 'rules', title: '아직 규칙이 없습니다', text: '규칙은 은행 거래가 도착하면 자동으로 분류합니다. 예를 들어 내용에 "Pixel Cloud"가 포함된 모든 거래를 소프트웨어로 분류할 수 있습니다.', action: el('button.btn.btn-primary', { type: 'button', onclick: () => openRuleForm() }, '규칙 만들기') }),
  });
  swap(main, el('div.page', {},
    pageHead({ title: '규칙', crumbs: [['규칙']], actions: [el('button.btn.btn-primary', { type: 'button', onclick: () => openRuleForm() }, '새 규칙')] }),
    el('p.field-hint', { style: { marginBottom: '12px' } }, '규칙은 위에서 아래로 적용되며, 거래에 처음으로 일치하는 규칙이 사용됩니다.'),
    table.root));
}

export function openRuleForm({ rule = null, fromLine = null, draft = null } = {}) {
  const r = rule ? structuredClone(rule) : {
    name: fromLine ? fromLine.desc.split(/\s+/).slice(0, 3).join(' ') : '',
    direction: fromLine ? (fromLine.amount < 0 ? 'out' : 'in') : 'out',
    accountIds: fromLine ? [fromLine.accountId] : [],
    match: 'all',
    conditions: [{ field: 'desc', op: 'contains', value: fromLine ? fromLine.desc.split(/\s+/).slice(0, 2).join(' ') : '' }],
    set: { categoryId: draft?.categoryId || null, contactId: draft?.contactId || null, memo: '', transferAccountId: null },
    autoAdd: false, active: true, priority: store.rules.size,
  };
  const name = textInput({ value: r.name });
  name.addEventListener('input', () => { r.name = name.value; });
  const dir = selectInput({ options: [['out', '지출'], ['in', '수입'], ['both', '수입 또는 지출']], value: r.direction, ariaLabel: '적용할 거래 유형', onChange: (v) => { r.direction = v; } });
  const accts = selectInput({ options: [['', '모든 은행 계좌'], ...store.accountsOfType('bank', 'creditCard').map((a) => [a.id, a.name])], value: r.accountIds?.[0] || '', ariaLabel: '계정', onChange: (v) => { r.accountIds = v ? [v] : []; } });
  const match = selectInput({ options: [['all', '모두'], ['any', '하나 이상']], value: r.match, ariaLabel: '일치', onChange: (v) => { r.match = v; } });
  const condBox = el('div.stack');
  function paintConds() {
    clear(condBox);
    r.conditions.forEach((c, i) => {
      const fieldSel = selectInput({ options: [['desc', '내용'], ['amount', '금액']], value: c.field, ariaLabel: `조건 ${i + 1} 항목`, onChange: (v) => { c.field = v; c.op = RULE_OPS[v][0][0]; c.value = ''; paintConds(); } });
      const opSel = selectInput({ options: RULE_OPS[c.field], value: c.op, ariaLabel: `조건 ${i + 1} 연산자`, onChange: (v) => { c.op = v; } });
      let val;
      if (c.field === 'amount') val = moneyInput({ value: c.value || null, ariaLabel: `조건 ${i + 1} 금액`, onChange: (v) => { c.value = v || 0; } }).root;
      else { val = textInput({ value: c.value || '', ariaLabel: `조건 ${i + 1} 텍스트` }); val.addEventListener('input', () => { c.value = val.value; }); }
      condBox.append(el('div.rule-cond', {}, fieldSel, opSel, val, r.conditions.length > 1 ? el('button.icon-btn', { type: 'button', 'aria-label': `조건 ${i + 1} 삭제`, html: icon('x', 16), onclick: () => { r.conditions.splice(i, 1); paintConds(); } }) : null));
    });
    condBox.append(el('button.btn.btn-sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { r.conditions.push({ field: 'desc', op: 'contains', value: '' }); paintConds(); } }, '조건 추가'));
  }
  paintConds();
  const cat = accountPicker({ value: r.set.categoryId, ariaLabel: '카테고리', onChange: (v) => { r.set.categoryId = v; } });
  const payee = contactPicker({ kind: 'any', value: r.set.contactId, ariaLabel: '거래처', onChange: (v) => { r.set.contactId = v; } });
  const transfer = accountPicker({ value: r.set.transferAccountId, types: ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity'], ariaLabel: '이체 계정', onChange: (v) => { r.set.transferAccountId = v; } });
  const memo = textInput({ value: r.set.memo || '' });
  memo.addEventListener('input', () => { r.set.memo = memo.value; });
  const kindSel = selectInput({ options: [['cat', '분류'], ['transfer', '이체로 기록']], value: r.set.transferAccountId ? 'transfer' : 'cat', ariaLabel: '지정', onChange: (v) => { catWrap.hidden = v !== 'cat'; tWrap.hidden = v !== 'transfer'; if (v === 'cat') r.set.transferAccountId = null; else r.set.categoryId = null; } });
  const catWrap = el('div.form-grid', { hidden: !!r.set.transferAccountId }, field('카테고리', cat), field('거래처', payee));
  const tWrap = el('div.form-grid', { hidden: !r.set.transferAccountId }, field('이체 계정', transfer));
  const auto = checkbox({ checked: !!r.autoAdd, label: '일치하는 거래를 장부에 자동으로 추가', onChange: (v) => { r.autoAdd = v; } });
  const active = checkbox({ checked: r.active !== false, label: '규칙 활성화', onChange: (v) => { r.active = v; } });
  const err = el('p.field-error', { role: 'alert', hidden: true });
  const save = () => {
    if (!r.name.trim()) { err.hidden = false; err.textContent = '규칙 이름을 입력하세요.'; return; }
    if (!r.conditions.some((c) => c.value)) { err.hidden = false; err.textContent = '값이 있는 조건을 하나 이상 추가하세요.'; return; }
    if (!r.set.categoryId && !r.set.transferAccountId && !r.set.contactId) { err.hidden = false; err.textContent = '규칙이 만들 결과를 선택하세요.'; return; }
    store.put('rules', r);
    toast('규칙이 저장되었습니다');
    dlg.close();
  };
  const dlg = openDialog({
    title: rule ? '규칙 편집' : '규칙 만들기',
    drawer: true,
    body: el('div.stack', {}, err,
      field('규칙 이름', name, { required: true }),
      el('div.form-grid', {}, field('적용할 거래 유형', dir), field('계정', accts)),
      el('div.row', {}, el('span', {}, '다음 중'), match, el('span', {}, '개와 일치하는 조건:')),
      condBox,
      el('fieldset.fieldset', {}, el('legend', {}, '그 다음'), field('거래 유형', kindSel), catWrap, tWrap, field('메모', memo)),
      auto, active),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', { type: 'button', onclick: save }, '저장')),
    initialFocus: name,
  });
  return dlg;
}
