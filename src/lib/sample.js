/**
 * A sample company: about nine months of a small design studio's books, so a
 * new user can explore every screen before entering their own numbers.
 * Deterministic (seeded), and every amount is generated through the same
 * saveTxn() path real entries use, so the sample is valid books by
 * construction.
 */
import { addDays, addMonths, startOfMonth } from './dates.js';
import { newId } from './ids.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMERS = [
  ['Northwind Traders', 'Ana Ruiz', 'accounts@northwind.example'],
  ['Bluebird Bakery', 'Sam Okafor', 'sam@bluebird.example'],
  ['Cedar and Pine Architects', 'Lena Fischer', 'billing@cedarpine.example'],
  ['Harbor Health Clinic', 'Priya Nair', 'finance@harborhealth.example'],
  ['Lumen Labs', 'Diego Costa', 'ap@lumenlabs.example'],
  ['Maple Street Books', 'Grace Kim', 'grace@maplestreet.example'],
  ['Summit Outdoor Co.', 'Tom Becker', 'payables@summit.example'],
];

const VENDORS = [
  ['Pixel Cloud Hosting', '사무용품 및 소프트웨어', 2900, 4900],
  ['Copperline Coworking', '임차료', 180000, 180000],
  ['City Power and Light', '공과금', 9000, 16000],
  ['Greenleaf Cafe', '식대', 1200, 6800],
  ['Swift Rideshare', '출장비', 1500, 5200],
  ['Northstar Insurance', '보험료', 24000, 24000],
  ['Inkwell Print Shop', '광고 및 홍보비', 8000, 42000],
  ['Freelance Illustrators Guild', '외주 용역비', 60000, 150000],
];

const ITEMS = [
  { name: '브랜드 아이덴티티 패키지', kind: 'service', price: 450000, income: '서비스', desc: '로고, 색상 팔레트, 타이포그래피와 가이드라인' },
  { name: '디자인 시간', kind: 'service', price: 12500, income: '서비스', desc: '시간 단위로 청구하는 디자인 작업' },
  { name: '웹사이트 디자인', kind: 'service', price: 820000, income: '서비스', desc: '반응형 마케팅 사이트 디자인' },
  { name: '인쇄 포스터', kind: 'nonInventory', price: 4500, cost: 1800, income: '매출', expense: '매출원가', taxable: true, desc: 'A2 포스터, 무광 용지' },
  { name: '월간 리테이너', kind: 'service', price: 250000, income: '서비스', desc: '지속적인 디자인 지원' },
];

/**
 * Sample customers, vendors, and products whose names the books already use.
 * Names must be unique, so the sample can only be added when this is empty;
 * checking first means a clash never leaves the sample half added.
 */
export function sampleConflicts(store) {
  const used = (names, name) => names.has(name.toLowerCase());
  const lower = (list) => new Set(list.map((n) => n.toLowerCase()));
  const customers = lower(store.contactsOf('customer', { includeInactive: true }).map((c) => c.displayName));
  const vendors = lower(store.contactsOf('vendor', { includeInactive: true }).map((c) => c.displayName));
  const items = lower(store.itemsList({ includeInactive: true }).map((i) => i.name));
  return [
    ...CUSTOMERS.map(([name]) => name).filter((n) => used(customers, n)),
    ...VENDORS.map(([name]) => name).filter((n) => used(vendors, n)),
    ...ITEMS.map((i) => i.name).filter((n) => used(items, n)),
  ];
}

/**
 * `asCompany` is for books being created as the sample company: it fills in the
 * company's contact details (keeping a name the user typed) and sets up the
 * sales tax rate. Adding sample data to existing books leaves both alone.
 */
export function loadSample(store, { asCompany = false } = {}) {
  const today = store.clock();
  const rand = rng(20261011);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  const acct = (name) => [...store.accounts.values()].find((a) => a.name === name)?.id;
  const start = startOfMonth(addMonths(today, -8));

  const tax = store.taxRateList()[0];
  if (asCompany) {
    store.saveSettings({ company: { name: store.settings.company?.name || 'Brightline Design Studio', email: 'hello@brightline.example', phone: '(555) 010-2040', address: { line1: '120 Market Street', city: 'Portland', state: 'OR', zip: '97204', country: 'US' } } });
    if (tax) store.put('taxRates', { ...tax, name: '주 판매세', rate: 650, agency: 'Department of Revenue' });
  }

  const customers = CUSTOMERS.map(([name, contact, email]) => {
    const [firstName, lastName] = contact.split(' ');
    return store.saveContact({ kind: 'customer', displayName: name, company: name, firstName, lastName, email, terms: pick(['net15', 'net30', 'net30']) });
  });
  const vendors = VENDORS.map(([name, category]) => store.saveContact({ kind: 'vendor', displayName: name, company: name, defaultAccountId: acct(category) }));

  const items = ITEMS.map(({ income, expense, ...item }) => store.saveItem({ ...item, incomeAccountId: acct(income), ...(expense ? { expenseAccountId: acct(expense) } : {}) }));

  const checking = acct('보통예금');
  const savings = acct('저축예금');
  const card = acct('신용카드');

  store.saveTxn({ type: 'deposit', date: start, accountId: checking, memo: '시작 자본', lines: [{ accountId: acct('사주출자금'), amount: 2500000, desc: '사주 투자' }] });
  store.saveTxn({ type: 'transfer', date: addDays(start, 2), fromId: checking, toId: savings, amount: 800000, memo: '예비 자금' });
  store.saveTxn({ type: 'expense', date: addDays(start, 3), accountId: checking, contactId: null, lines: [{ accountId: acct('가구 및 기기'), amount: 389900, desc: '워크스테이션과 모니터' }], memo: '기기 구입' });

  let invNum = 1001;
  const openInvoices = [];
  for (let m = 0; m < 9; m++) {
    const monthStart = addMonths(start, m, 1);
    if (monthStart > today) break;
    // Rent, hosting, insurance, utilities.
    const bills = [
      [vendors[1], 180000, 1],
      [vendors[2], between(9000, 16000), 6],
    ];
    for (const [v, amount, day] of bills) {
      const date = addDays(monthStart, day);
      if (date > today) continue;
      const desc = `${v.displayName} 월 청구분`;
      const bill = store.saveTxn({ type: 'bill', date, dueDate: addDays(date, 15), contactId: v.id, num: `B-${m}${day}`, lines: [{ accountId: v.defaultAccountId, amount, desc }] });
      const payDate = addDays(date, between(5, 14));
      if (payDate <= addDays(today, -3)) store.saveTxn({ type: 'billPayment', date: payDate, contactId: v.id, accountId: checking, amount, applied: [{ txnId: bill.id, amount }] });
    }
    // Card spending.
    for (let k = 0; k < 6; k++) {
      const v = pick([vendors[0], vendors[3], vendors[4], vendors[6], vendors[3]]);
      const date = addDays(monthStart, between(0, 27));
      if (date > today) continue;
      const [, , lo, hi] = VENDORS[vendors.indexOf(v)];
      store.saveTxn({ type: 'expense', date, accountId: card, contactId: v.id, paymentMethod: '신용카드', lines: [{ accountId: v.defaultAccountId, amount: between(lo, hi), desc: v.displayName }] });
    }
    if (m % 3 === 0) {
      const date = addDays(monthStart, 9);
      if (date <= today) store.saveTxn({ type: 'check', date, num: String(2001 + m), accountId: checking, contactId: vendors[5].id, lines: [{ accountId: acct('보험료'), amount: 72000, desc: '분기 배상책임 보험료' }] });
    }
    // Contractors, on a bill.
    if (m % 2 === 1) {
      const date = addDays(monthStart, 12);
      if (date <= today) {
        const amount = between(60000, 150000);
        const bill = store.saveTxn({ type: 'bill', date, dueDate: addDays(date, 30), contactId: vendors[7].id, lines: [{ accountId: acct('외주 용역비'), amount, desc: '일러스트 작업' }] });
        if (addDays(date, 25) <= today) store.saveTxn({ type: 'billPayment', date: addDays(date, 25), contactId: vendors[7].id, accountId: checking, amount, applied: [{ txnId: bill.id, amount }] });
      }
    }
    // Pay the card from checking.
    const ccDate = addDays(monthStart, 20);
    if (ccDate <= today && m > 0) store.saveTxn({ type: 'ccPayment', date: ccDate, ccAccountId: card, bankAccountId: checking, amount: between(30000, 60000) });

    // Invoices.
    for (let k = 0; k < 4; k++) {
      const c = customers[(m * 4 + k) % customers.length];
      const date = addDays(monthStart, between(0, 25));
      if (date > today) continue;
      const lines = [];
      const kind = rand();
      if (kind < 0.25) lines.push({ itemId: items[0].id, desc: items[0].desc, qty: 1, rate: items[0].price });
      else if (kind < 0.4) lines.push({ itemId: items[2].id, desc: items[2].desc, qty: 1, rate: items[2].price });
      else if (kind < 0.7) lines.push({ itemId: items[4].id, desc: items[4].desc, qty: 1, rate: items[4].price });
      else lines.push({ itemId: items[1].id, desc: items[1].desc, qty: between(6, 40), rate: items[1].price });
      if (rand() < 0.35) lines.push({ itemId: items[3].id, desc: items[3].desc, qty: between(10, 60), rate: items[3].price, taxable: true });
      const terms = c.terms || 'net30';
      const days = terms === 'net15' ? 15 : 30;
      const inv = store.saveTxn({ type: 'invoice', date, dueDate: addDays(date, days), terms, num: String(invNum++), contactId: c.id, taxRateId: tax?.id || null, lines, message: '거래에 감사드립니다.' });
      const total = store.total(inv);
      const payDate = addDays(date, between(8, 45));
      if (payDate <= addDays(today, -2) && rand() < 0.85) {
        const amount = rand() < 0.12 ? Math.round(total / 2) : total;
        store.saveTxn({ type: 'payment', date: payDate, contactId: c.id, amount, depositToId: rand() < 0.7 ? checking : acct('미입금자금'), paymentMethod: pick(['수표', '계좌이체', '신용카드']), applied: [{ txnId: inv.id, amount }] });
      } else {
        openInvoices.push(inv);
      }
    }
  }

  // Deposit whatever is sitting in Undeposited Funds, except the newest.
  const undeposited = store.undepositedItems().filter((t) => t.date < addDays(today, -10));
  if (undeposited.length) {
    store.saveTxn({ type: 'deposit', date: addDays(today, -7), accountId: checking, memo: '입금', lines: undeposited.map((t) => ({ paymentId: t.id, contactId: t.contactId, amount: store.total(t), desc: '수금' })) });
  }

  // An estimate waiting for an answer, and a recurring retainer.
  store.saveTxn({ type: 'estimate', date: addDays(today, -4), expiryDate: addDays(today, 26), num: '1001', contactId: customers[4].id, status: 'pending', lines: [{ itemId: items[2].id, desc: items[2].desc, qty: 1, rate: items[2].price }] });
  store.put('recurring', {
    name: 'Bluebird Bakery retainer', type: 'invoice', interval: 'month', every: 1, startDate: addMonths(startOfMonth(today), 1), nextDate: addMonths(startOfMonth(today), 1), mode: 'scheduled', active: true, count: 0,
    template: { type: 'invoice', contactId: customers[1].id, terms: 'net15', lines: [{ itemId: items[4].id, desc: items[4].desc, qty: 1, rate: items[4].price }] },
  });

  // A bank rule and a fresh batch of statement lines to review.
  store.put('rules', { name: '호스팅', direction: 'out', match: 'all', conditions: [{ field: 'desc', op: 'contains', value: 'pixel cloud' }], set: { categoryId: acct('사무용품 및 소프트웨어'), contactId: vendors[0].id }, accountIds: [], active: true, priority: 0 });
  const importId = newId();
  const feed = [
    [-4900, 'PIXEL CLOUD HOSTING MONTHLY'],
    [-1875, 'GREENLEAF CAFE PORTLAND'],
    [-3240, 'SWIFT RIDESHARE TRIP'],
    [-1299, 'STOCK PHOTO SUBSCRIPTION'],
    [125, 'INTEREST PAYMENT'],
    [-2500, 'BANK SERVICE FEE'],
  ];
  feed.forEach(([amount, desc], i) => {
    store.put('bankLines', { accountId: checking, date: addDays(today, -6 + i), amount, desc, fitid: `S${i}`, status: 'review', importId });
  });
  void openInvoices;
}
