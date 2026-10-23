/** Customers and vendors: the list, and one contact's page. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable, sortRows } from '../ui/table.js';
import { amountNode, statusBadge, dateText, initials } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { download } from '../ui/dom.js';
import { pageHead, splitButton, searchBox, emptyState, viewState, tabs, menuButton } from './page.js';
import { store } from '../lib/store.js';
import { typeLabel } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today } from '../lib/dates.js';
import { toCSV } from '../lib/csv.js';
import { openContactForm } from '../forms/contact.js';
import { openTxnForm, openTxn } from '../forms/index.js';
import { openImport } from './importer.js';

export function renderContacts(main, route) {
  const kind = route.name === 'vendors' ? 'vendor' : 'customer';
  const Kind = kind === 'vendor' ? '공급처' : '고객';
  const st = viewState(`contacts:${kind}`, { q: '', show: 'active', sort: { key: 'name', dir: 'asc' } });
  const balances = store.contactBalances(kind);
  const info = store.docInfo();
  const now = today();
  const overdueBy = new Map();
  const openBy = new Map();
  for (const t of store.txns.values()) {
    if (t.voided || t.type !== (kind === 'vendor' ? 'bill' : 'invoice')) continue;
    const open = info.open.get(t.id) || 0;
    if (open <= 0) continue;
    openBy.set(t.contactId, (openBy.get(t.contactId) || 0) + 1);
    if (t.dueDate && t.dueDate < now) overdueBy.set(t.contactId, (overdueBy.get(t.contactId) || 0) + open);
  }
  const q = st.q.trim().toLowerCase();
  let rows = store.contactsOf(kind, { includeInactive: st.show !== 'active' }).filter((c) => (st.show !== 'inactive' || c.active === false));
  if (q) rows = rows.filter((c) => [c.displayName, c.company, c.email, c.phone].join(' ').toLowerCase().includes(q));
  const columns = [
    { key: 'name', label: kind === 'vendor' ? '공급처' : '고객', primary: true, render: (c) => el('div', {}, el('div.cell-main', {}, c.displayName, c.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, '비활성') : null), c.company && c.company !== c.displayName ? el('div.cell-sub', {}, c.company) : null), sortValue: (c) => c.displayName.toLowerCase() },
    { key: 'email', label: '이메일', hideMobile: true, render: (c) => c.email || '', sortValue: (c) => c.email || '' },
    { key: 'phone', label: '전화', hideMobile: true, render: (c) => c.phone || c.mobile || '', sortable: false },
    { key: 'open', label: kind === 'vendor' ? '미결 매입채무' : '미수 청구서', align: 'right', hideMobile: true, render: (c) => String(openBy.get(c.id) || ''), sortValue: (c) => openBy.get(c.id) || 0 },
    { key: 'overdue', label: '연체', align: 'right', hideMobile: true, render: (c) => (overdueBy.get(c.id) ? amountNode(overdueBy.get(c.id)) : ''), sortValue: (c) => overdueBy.get(c.id) || 0 },
    { key: 'balance', label: '미결제 잔액', align: 'right', amount: true, render: (c) => amountNode(balances.get(c.id) || 0), sortValue: (c) => balances.get(c.id) || 0 },
    {
      key: 'action', label: '작업', srLabel: '작업', className: 'actions-cell', sortable: false,
      render: (c) => el('div.row', { style: { justifyContent: 'flex-end' } },
        kind === 'customer'
          ? el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'invoice', draft: { contactId: c.id } }) }, '청구서 만들기')
          : el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'bill', draft: { contactId: c.id } }) }, '매입채무 등록')),
    },
  ];
  rows = sortRows(rows, columns, st.sort);
  const totalOpen = rows.reduce((s, c) => s + (balances.get(c.id) || 0), 0);
  const totalOverdue = rows.reduce((s, c) => s + (overdueBy.get(c.id) || 0), 0);

  const table = dataTable({
    columns, rows, ariaLabel: `${Kind}`,
    sort: st.sort, onSort: (s) => { st.sort = s; renderContacts(main, route); },
    onRowClick: (c) => navigate(`${kind}/${c.id}`),
    empty: emptyState({ iconName: kind === 'vendor' ? 'vendor' : 'users', title: q ? '일치하는 항목이 없습니다' : `아직 ${Kind}가 없습니다`, text: q ? '다른 검색어로 시도해 보세요.' : `${Kind}를 추가하면 청구서 발행, 미수금 확인, ${Kind}별 보고서를 사용할 수 있습니다.`, action: q ? null : el('button.btn.btn-primary', { type: 'button', onclick: () => openContactForm({ kind }) }, `${Kind} 추가`) }),
  });

  const exportCsv = () => download(toCSV([
    ['표시 이름', '회사', '이름', '성', '이메일', '전화', '주소', '도시', '시/도', '우편번호', '국가', '미결제 잔액', '메모'],
    ...rows.map((c) => [c.displayName, c.company || '', c.firstName || '', c.lastName || '', c.email || '', c.phone || '', c.billAddr?.line1 || '', c.billAddr?.city || '', c.billAddr?.state || '', c.billAddr?.zip || '', c.billAddr?.country || '', ((balances.get(c.id) || 0) / 100).toFixed(2), c.notes || '']),
  ]), `${kind}s-${today()}.csv`, 'text/csv');

  swap(main, el('div.page', {},
    pageHead({
      title: kind === 'vendor' ? '공급처' : '고객',
      crumbs: kind === 'vendor' ? [['지출', 'expenses'], ['공급처']] : [['판매', 'sales'], ['고객']],
      actions: [splitButton(`새 ${Kind}`, () => openContactForm({ kind }), [{ label: `${Kind} 가져오기`, icon: 'upload', onClick: () => openImport(kind === 'vendor' ? 'vendors' : 'customers') }, { label: 'CSV로 내보내기', icon: 'download', onClick: exportCsv }])],
    }),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.kpi-label', {}, '미결제 잔액'), el('div.kpi-value', {}, formatMoney(totalOpen))),
      el('div.stat', {}, el('div.kpi-label', {}, '연체'), el('div.kpi-value', { class: totalOverdue ? 'neg' : '' }, formatMoney(totalOverdue))),
      el('div.stat', {}, el('div.kpi-label', {}, `${Kind}`), el('div.kpi-value', {}, String(rows.length)))),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: `${Kind} 검색`, label: `${Kind} 검색`, onInput: (v) => { st.q = v; renderContacts(main, route); main.querySelector('input[type="search"]')?.focus(); } }),
      el('select.select', { 'aria-label': '표시', onchange: (e) => { st.show = e.target.value; renderContacts(main, route); } },
        ...[['active', '활성'], ['all', '전체'], ['inactive', '비활성']].map(([v, l]) => el('option', { value: v, selected: st.show === v }, l)))),
    table.root));
}

export function renderContact(main, route) {
  const c = store.contact(route.params[0]);
  if (!c) {
    swap(main, el('div.page', {}, emptyState({ title: '거래처를 찾을 수 없습니다', text: '삭제되었을 수 있습니다.', action: el('a.btn', { href: '#/customers' }, '고객 목록으로 돌아가기') })));
    return;
  }
  const kind = c.kind;
  const st = viewState(`contact:${c.id}`, { tab: 'txns' });
  const balance = store.contactBalances(kind).get(c.id) || 0;
  const info = store.docInfo();
  const now = today();
  let overdue = 0;
  const txns = store.txnList((t) => t.contactId === c.id || (t.lines || []).some((l) => l.contactId === c.id || l.customerId === c.id));
  for (const t of txns) if ((t.type === 'invoice' || t.type === 'bill') && !t.voided && t.dueDate && t.dueDate < now) overdue += Math.max(0, info.open.get(t.id) || 0);

  const columns = [
    { key: 'date', label: '날짜', render: (t) => dateText(t.date), sortable: false },
    { key: 'type', label: '유형', primary: true, render: (t) => el('span.cell-main', {}, typeLabel(t.type)), sortable: false },
    { key: 'num', label: '번호', render: (t) => t.num || '', sortable: false },
    { key: 'due', label: '만기일', hideMobile: true, render: (t) => dateText(t.dueDate), sortable: false },
    { key: 'amount', label: '금액', align: 'right', amount: true, render: (t) => amountNode(store.total(t)), sortable: false },
    { key: 'open', label: '미결제 잔액', align: 'right', render: (t) => (['invoice', 'bill', 'payment', 'billPayment', 'creditMemo', 'vendorCredit'].includes(t.type) ? amountNode(store.openBalance(t.id)) : ''), sortable: false },
    { key: 'status', label: '상태', render: (t) => statusBadge(store.status(t)), sortable: false },
  ];
  const table = dataTable({ columns, rows: txns, ariaLabel: `${c.displayName} 거래 내역`, onRowClick: (t) => openTxn(t.id), empty: emptyState({ title: '아직 거래가 없습니다', text: kind === 'vendor' ? '이 공급처의 매입채무와 지출이 여기에 표시됩니다.' : '이 고객의 청구서와 결제가 여기에 표시됩니다.' }) });

  const addr = c.billAddr || {};
  const details = el('dl.keyval', {},
    c.company ? [el('dt', {}, '회사'), el('dd', {}, c.company)] : null,
    c.email ? [el('dt', {}, '이메일'), el('dd', {}, el('a', { href: `mailto:${c.email}` }, c.email))] : null,
    c.phone ? [el('dt', {}, '전화'), el('dd', {}, el('a', { href: `tel:${c.phone}` }, c.phone))] : null,
    c.mobile ? [el('dt', {}, '휴대전화'), el('dd', {}, c.mobile)] : null,
    c.website ? [el('dt', {}, '웹사이트'), el('dd', {}, c.website)] : null,
    addr.line1 ? [el('dt', {}, '청구지 주소'), el('dd', { style: { whiteSpace: 'pre-line' } }, [addr.line1, addr.line2, [addr.city, addr.state, addr.zip].filter(Boolean).join(' '), addr.country].filter(Boolean).join('\n'))] : null,
    c.terms ? [el('dt', {}, '지급 조건'), el('dd', {}, (store.settings.terms || []).find((t) => t.id === c.terms)?.name || '')] : null,
    kind === 'vendor' && c.defaultAccountId ? [el('dt', {}, '기본 카테고리'), el('dd', {}, store.accountName(c.defaultAccountId))] : null,
    c.notes ? [el('dt', {}, '메모'), el('dd', { style: { whiteSpace: 'pre-line' } }, c.notes)] : null);

  const newItems = kind === 'customer'
    ? [['청구서', 'invoice'], ['결제', 'payment'], ['견적서', 'estimate'], ['매출 영수증', 'salesReceipt'], ['대변 메모', 'creditMemo'], ['환불 영수증', 'refundReceipt']]
    : [['매입채무', 'bill'], ['지출', 'expense'], ['수표', 'check'], ['매입채무 결제', 'billPayment'], ['발주서', 'purchaseOrder'], ['공급처 대변', 'vendorCredit']];

  const remove = async () => {
    const used = store.contactInUse(c.id);
    const ok = await confirmDialog({ title: used ? `${c.displayName}을(를) 비활성화하시겠습니까?` : `${c.displayName}을(를) 삭제하시겠습니까?`, message: used ? '이 거래처에는 거래가 있어 삭제 대신 비활성화됩니다. 기록은 보고서에 그대로 남습니다.' : '이 거래처는 완전히 삭제됩니다.', confirmLabel: used ? '비활성화' : '삭제', danger: !used });
    if (!ok) return;
    try {
      const r = store.deleteContact(c.id);
      toast(r === 'inactive' ? '비활성화했습니다' : '삭제했습니다');
      if (r === 'deleted') navigate(kind === 'vendor' ? 'vendors' : 'customers');
    } catch (err) { toastError(err); }
  };

  swap(main, el('div.page', {},
    pageHead({
      title: el('span.row', {}, el('span.avatar.avatar-lg', { 'aria-hidden': 'true' }, initials(c.displayName)), c.displayName),
      crumbs: kind === 'vendor' ? [['공급처', 'vendors'], [c.displayName]] : [['고객', 'customers'], [c.displayName]],
      actions: [
        el('button.btn', { type: 'button', onclick: () => openContactForm({ kind, contact: c }) }, '편집'),
        menuButton('더 보기', [
          kind === 'customer' ? { label: '고객 거래 명세서', icon: 'printer', onClick: () => navigate(`report/openInvoices?contact=${c.id}`) } : null,
          { label: c.active === false ? '다시 활성화' : '비활성화', onClick: () => store.saveContact({ ...c, active: c.active === false }) },
          { label: '삭제', icon: 'trash', danger: true, onClick: remove },
        ].filter(Boolean)),
        splitButton('새 거래', () => openTxnForm({ type: newItems[0][1], draft: { contactId: c.id } }), newItems.map(([label, type]) => ({ label, onClick: () => openTxnForm({ type, draft: { contactId: c.id } }) }))),
      ],
    }),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.kpi-label', {}, '미결제 잔액'), el('div.kpi-value', {}, formatMoney(balance))),
      el('div.stat', {}, el('div.kpi-label', {}, '연체'), el('div.kpi-value', { class: overdue ? 'neg' : '' }, formatMoney(overdue)))),
    tabs([['txns', '거래 목록'], ['details', `${kind === 'vendor' ? '공급처' : '고객'} 정보`]], st.tab, (k) => { st.tab = k; renderContact(main, route); }),
    st.tab === 'txns' ? table.root : el('div.card', {}, el('div.card-body', {}, details))));
}
