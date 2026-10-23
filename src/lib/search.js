/**
 * Global search over the in-memory books. The haystack strings are built
 * once per store version; a query is a linear scan with early exit, which
 * is well under a frame for tens of thousands of transactions.
 */
import { typeLabel, TXN_TYPES } from './txn.js';
import { parseMoney } from './money.js';
import { REPORTS } from './reports.js';

function norm(s) {
  return String(s || '').toLowerCase();
}

function index(store) {
  return store.memo('searchIndex', () => {
    const txns = [];
    for (const t of store.txnList()) {
      txns.push({
        t,
        hay: norm([typeLabel(t.type), t.num, store.contactName(t.contactId), t.memo, t.ref, ...(t.lines || []).map((l) => l.desc)].filter(Boolean).join(' ')),
        num: norm(t.num),
        total: store.total(t),
      });
    }
    const contacts = [...store.contacts.values()].map((c) => ({ c, hay: norm([c.displayName, c.company, c.email, c.phone].join(' ')) }));
    const accounts = store.chart().map(({ account: a }) => ({ a, hay: norm(`${a.number || ''} ${a.name} ${a.description || ''}`) }));
    const items = store.itemsList().map((i) => ({ i, hay: norm(`${i.name} ${i.sku || ''} ${i.desc || ''}`) }));
    return { txns, contacts, accounts, items };
  });
}

export const PAGES = [
  ['홈', 'home', '대시보드 요약'],
  ['은행 거래', 'banking', '은행 거래 검토 가져오기 거래내역'],
  ['계좌 대조', 'reconcile', '거래내역'],
  ['자동 분개 규칙', 'rules', '자동 분류'],
  ['계정과목표', 'accounts', '원장'],
  ['반복 거래', 'recurring', '일정 템플릿'],
  ['전체 매출', 'sales', '매출 거래'],
  ['청구서', 'invoices', '미결 연체'],
  ['견적서', 'estimates', '견적'],
  ['고객', 'customers', '거래처'],
  ['상품 및 서비스', 'items', '품목 가격표'],
  ['전체 매입', 'expenses', '지출 매입'],
  ['지출결의서', 'bills', '미지급 매입'],
  ['공급처', 'vendors', '공급업체'],
  ['보고서', 'reports', '재무제표'],
  ['부가세', 'sales-tax', '세율'],
  ['설정', 'settings', '회사 환경설정'],
  ['감사 로그', 'audit', '이력 변경'],
];

/**
 * Returns [{ group, items: [{ label, sub, route, kind }] }].
 */
export function search(store, query, { limit = 8 } = {}) {
  const q = norm(query).trim();
  if (!q) return [];
  const ix = index(store);
  const groups = [];
  const words = q.split(/\s+/);
  const hit = (hay) => words.every((w) => hay.includes(w));

  const pages = PAGES.filter(([label, , extra]) => hit(norm(`${label} ${extra}`))).slice(0, 4)
    .map(([label, route]) => ({ label, sub: '페이지로 이동', route, kind: 'page' }));
  const reports = REPORTS.filter((r) => hit(norm(`${r.title} ${r.group}`))).slice(0, 4)
    .map((r) => ({ label: r.title, sub: '보고서', route: `report/${r.id}`, kind: 'report' }));

  const amount = /^[\d$.,()-]+$/.test(q) ? Math.abs(parseMoney(q)) : 0;
  const txns = [];
  for (const e of ix.txns) {
    const numMatch = e.num && (e.num === q || e.num.startsWith(q));
    const amtMatch = amount && Math.abs(e.total) === amount;
    if (numMatch || amtMatch || hit(e.hay)) {
      txns.push({ e, rank: numMatch ? 0 : amtMatch ? 1 : 2 });
      if (txns.length > 200) break;
    }
  }
  txns.sort((a, b) => a.rank - b.rank);
  const txnItems = txns.slice(0, limit).map(({ e }) => ({
    label: `${typeLabel(e.t.type)}${e.t.num ? ` ${e.t.num}` : ''}`,
    sub: [e.t.date, store.contactName(e.t.contactId)].filter(Boolean).join(' · '),
    amount: e.total,
    route: `txn/${e.t.id}`,
    kind: 'txn',
    txnType: e.t.type,
  }));

  const contacts = ix.contacts.filter((x) => hit(x.hay)).slice(0, limit).map(({ c }) => ({
    label: c.displayName, sub: c.kind === 'vendor' ? '공급처' : '고객', route: `${c.kind === 'vendor' ? 'vendor' : 'customer'}/${c.id}`, kind: 'contact',
  }));
  const accounts = ix.accounts.filter((x) => hit(x.hay)).slice(0, 5).map(({ a }) => ({
    label: store.accountName(a.id), sub: '계정', route: `register/${a.id}`, kind: 'account',
  }));
  const items = ix.items.filter((x) => hit(x.hay)).slice(0, 5).map(({ i }) => ({
    label: i.name, sub: '품목', route: `items?edit=${i.id}`, kind: 'item',
  }));

  const create = Object.entries(TXN_TYPES)
    .filter(([, m]) => hit(norm(`새 만들기 ${m.label} 추가`)))
    .slice(0, 3)
    .map(([type, m]) => ({ label: `${m.label} 만들기`, sub: '만들기', route: `new/${m.route}`, kind: 'create', txnType: type }));

  if (create.length && words.some((w) => ['새', '만들기', '추가'].includes(w))) groups.push({ group: '만들기', items: create });
  if (txnItems.length) groups.push({ group: '거래', items: txnItems });
  if (contacts.length) groups.push({ group: '거래처', items: contacts });
  if (accounts.length) groups.push({ group: '계정', items: accounts });
  if (items.length) groups.push({ group: '상품 및 서비스', items });
  if (reports.length) groups.push({ group: '보고서', items: reports });
  if (pages.length) groups.push({ group: '페이지', items: pages });
  if (create.length && !groups.some((g) => g.group === '만들기')) groups.push({ group: '만들기', items: create });
  return groups;
}
