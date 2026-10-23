/** Products and services. */
import { el, swap } from '../ui/dom.js';
import { dataTable, sortRows } from '../ui/table.js';
import { amountNode } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { pageHead, splitButton, searchBox, emptyState, viewState } from './page.js';
import { store } from '../lib/store.js';
import { openItemForm } from '../forms/item.js';
import { openImport } from './importer.js';
import { setQuery } from '../ui/router.js';

export function renderItems(main, route) {
  const st = viewState('items', { q: '', show: 'active', sort: { key: 'name', dir: 'asc' } });
  if (route.query.edit) {
    const it = store.item(route.query.edit);
    setQuery({ edit: null });
    if (it) setTimeout(() => openItemForm({ item: it }));
  }
  const q = st.q.trim().toLowerCase();
  let rows = store.itemsList({ includeInactive: st.show !== 'active' }).filter((i) => st.show !== 'inactive' || i.active === false);
  if (q) rows = rows.filter((i) => `${i.name} ${i.sku || ''} ${i.desc || ''}`.toLowerCase().includes(q));
  const used = new Map();
  for (const t of store.txns.values()) for (const l of t.lines || []) if (l.itemId) used.set(l.itemId, (used.get(l.itemId) || 0) + 1);
  const columns = [
    { key: 'name', label: '이름', primary: true, render: (i) => el('div', {}, el('div.cell-main', {}, i.name, i.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, '비활성') : null), i.desc ? el('div.cell-sub.truncate', { style: { maxWidth: '420px' } }, i.desc) : null), sortValue: (i) => i.name.toLowerCase() },
    { key: 'sku', label: 'SKU', hideMobile: true, render: (i) => i.sku || '', sortValue: (i) => i.sku || '' },
    { key: 'kind', label: '유형', render: (i) => (i.kind === 'nonInventory' ? '재고 아님' : '서비스'), sortValue: (i) => i.kind },
    { key: 'income', label: '수익 계정', hideMobile: true, render: (i) => store.accountName(i.incomeAccountId), sortable: false },
    { key: 'price', label: '판매가', align: 'right', amount: true, render: (i) => amountNode(i.price || 0), sortValue: (i) => i.price || 0 },
    { key: 'cost', label: '원가', align: 'right', hideMobile: true, render: (i) => (i.purchased ? amountNode(i.cost || 0) : ''), sortValue: (i) => i.cost || 0 },
    { key: 'tax', label: '부가세 과세', hideMobile: true, render: (i) => (i.taxable ? '예' : ''), sortable: false },
    {
      key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false,
      render: (i) => el('button.row-link', {
        type: 'button',
        onclick: async () => {
          if (used.has(i.id)) {
            store.saveItem({ ...i, active: i.active === false });
            toast(i.active === false ? '활성화했습니다' : '비활성화했습니다');
          } else if (await confirmDialog({ title: `${i.name}을(를) 삭제하시겠습니까?`, message: '어떤 거래에서도 사용되지 않았습니다.', confirmLabel: '삭제', danger: true })) {
            store.remove('items', i.id);
            toast('삭제했습니다');
          }
        },
      }, used.has(i.id) ? (i.active === false ? '다시 활성화' : '비활성화') : '삭제'),
    },
  ];
  rows = sortRows(rows, columns, st.sort);
  const table = dataTable({
    columns, rows, ariaLabel: '제품과 서비스',
    sort: st.sort, onSort: (s) => { st.sort = s; renderItems(main, { ...route, query: {} }); },
    onRowClick: (i) => openItemForm({ item: i }),
    empty: emptyState({ iconName: 'item', title: q ? '일치하는 항목이 없습니다' : '아직 제품이나 서비스가 없습니다', text: '판매하는 것을 등록해 두면 청구서 작성 시 한 번의 선택으로 채울 수 있습니다.', action: q ? null : el('button.btn.btn-primary', { type: 'button', onclick: () => openItemForm() }, '새 제품 또는 서비스') }),
  });
  swap(main, el('div.page', {},
    pageHead({ title: '제품과 서비스', crumbs: [['판매', 'sales'], ['제품과 서비스']], actions: [splitButton('새로 만들기', () => openItemForm(), [{ label: 'CSV에서 가져오기', icon: 'upload', onClick: () => openImport('items') }])] }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: '이름 또는 SKU로 검색', label: '제품과 서비스 검색', onInput: (v) => { st.q = v; renderItems(main, { ...route, query: {} }); main.querySelector('input[type="search"]')?.focus(); } }),
      el('select.select', { 'aria-label': '표시', onchange: (e) => { st.show = e.target.value; renderItems(main, { ...route, query: {} }); } },
        ...[['active', '활성'], ['all', '전체'], ['inactive', '비활성']].map(([v, l]) => el('option', { value: v, selected: st.show === v }, l)))),
    table.root));
}
