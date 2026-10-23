/**
 * Account types and the default chart of accounts.
 *
 * `cls` is the statement class, `sign` the normal balance (+1 debit, -1
 * credit). Balances are kept as debit-positive sums of postings; a report
 * multiplies by `sign` so an income account with credits shows positive.
 */
export const ACCOUNT_TYPES = {
  bank: { label: '은행', cls: 'asset', group: 'currentAssets', sign: 1, order: 10, register: true },
  ar: { label: '외상매출금', cls: 'asset', group: 'currentAssets', sign: 1, order: 20 },
  otherCurrentAsset: { label: '기타 유동자산', cls: 'asset', group: 'currentAssets', sign: 1, order: 30, register: true },
  fixedAsset: { label: '고정자산', cls: 'asset', group: 'fixedAssets', sign: 1, order: 40, register: true },
  otherAsset: { label: '기타 자산', cls: 'asset', group: 'otherAssets', sign: 1, order: 50, register: true },
  ap: { label: '외상매입금', cls: 'liability', group: 'currentLiabilities', sign: -1, order: 60 },
  creditCard: { label: '신용카드', cls: 'liability', group: 'currentLiabilities', sign: -1, order: 70, register: true },
  otherCurrentLiability: { label: '기타 유동부채', cls: 'liability', group: 'currentLiabilities', sign: -1, order: 80, register: true },
  longTermLiability: { label: '장기부채', cls: 'liability', group: 'longTermLiabilities', sign: -1, order: 90, register: true },
  equity: { label: '자본', cls: 'equity', group: 'equity', sign: -1, order: 100, register: true },
  income: { label: '수익', cls: 'income', group: 'income', sign: -1, order: 110 },
  otherIncome: { label: '기타 수익', cls: 'income', group: 'otherIncome', sign: -1, order: 120 },
  cogs: { label: '매출원가', cls: 'expense', group: 'cogs', sign: 1, order: 130 },
  expense: { label: '비용', cls: 'expense', group: 'expenses', sign: 1, order: 140 },
  otherExpense: { label: '기타 비용', cls: 'expense', group: 'otherExpenses', sign: 1, order: 150 },
};

export const TYPE_KEYS = Object.keys(ACCOUNT_TYPES);

export function typeInfo(type) {
  return ACCOUNT_TYPES[type] || ACCOUNT_TYPES.expense;
}

export function isBalanceSheet(type) {
  const c = typeInfo(type).cls;
  return c === 'asset' || c === 'liability' || c === 'equity';
}

export function isProfitAndLoss(type) {
  return !isBalanceSheet(type);
}

/** Accounts money can be paid from: bank and credit card (plus cash-like assets). */
export function isPaymentAccount(type) {
  return type === 'bank' || type === 'creditCard' || type === 'otherCurrentAsset';
}

export function isBankLike(type) {
  return type === 'bank' || type === 'creditCard';
}

/**
 * Roles mark the accounts the bookkeeping engine itself depends on. There is
 * exactly one of each; the user can rename them but not delete them.
 */
export const ROLES = {
  ar: '외상매출금',
  ap: '외상매입금',
  undeposited: '미입금자금',
  salesTax: '미지급 부가세',
  openingBalance: '기초 잔액',
  retainedEarnings: '이익잉여금',
  inventory: '재고자산',
  cogs: '매출원가',
  sales: '매출',
  uncategorizedIncome: '미분류 수익',
  uncategorizedExpense: '미분류 비용',
  uncategorizedAsset: '미분류 자산',
  reconDiscrepancy: '계좌 대조 조정',
  discounts: '지급 할인',
};

/** [number, name, type, role?, description?] */
export const DEFAULT_CHART = [
  ['1000', '보통예금', 'bank', null, '주 업무용 보통예금 계좌'],
  ['1010', '저축예금', 'bank'],
  ['1100', '외상매출금', 'ar', 'ar', '고객이 지급할 금액'],
  ['1200', '미입금자금', 'otherCurrentAsset', 'undeposited', '받았지만 아직 예치하지 않은 금액'],
  ['1300', '재고자산', 'otherCurrentAsset', 'inventory'],
  ['1400', '선급금', 'otherCurrentAsset'],
  ['1499', '미분류 자산', 'otherCurrentAsset', 'uncategorizedAsset'],
  ['1500', '가구 및 기기', 'fixedAsset'],
  ['1590', '감가상각누계액', 'fixedAsset'],
  ['2000', '외상매입금', 'ap', 'ap', '공급처에 지급할 금액'],
  ['2100', '신용카드', 'creditCard'],
  ['2200', '미지급 부가세', 'otherCurrentLiability', 'salesTax', '징수하여 세무서에 납부할 부가세'],
  ['2300', '급여 미지급금', 'otherCurrentLiability'],
  ['2700', '미지급차입금', 'longTermLiability'],
  ['3000', '기초 잔액', 'equity', 'openingBalance'],
  ['3100', '사주출자금', 'equity'],
  ['3200', '사주인출금', 'equity'],
  ['3900', '이익잉여금', 'equity', 'retainedEarnings'],
  ['4000', '매출', 'income', 'sales', '상품과 서비스 판매에서 나온 수익'],
  ['4100', '서비스', 'income'],
  ['4200', '지급 할인', 'income', 'discounts'],
  ['4900', '미분류 수익', 'income', 'uncategorizedIncome'],
  ['5000', '매출원가', 'cogs', 'cogs'],
  ['6000', '광고 및 홍보비', 'expense'],
  ['6010', '은행 수수료', 'expense'],
  ['6020', '차량 유지비', 'expense'],
  ['6030', '외주 용역비', 'expense'],
  ['6040', '감가상각비', 'expense'],
  ['6050', '보험료', 'expense'],
  ['6060', '지급 이자', 'expense'],
  ['6070', '법률·전문 서비스비', 'expense'],
  ['6080', '식대', 'expense'],
  ['6090', '사무용품 및 소프트웨어', 'expense'],
  ['6100', '급여 비용', 'expense'],
  ['6110', '임차료', 'expense'],
  ['6120', '수선 및 유지비', 'expense'],
  ['6130', '세금 및 등록면허', 'expense'],
  ['6140', '출장비', 'expense'],
  ['6150', '공과금', 'expense'],
  ['6999', '미분류 비용', 'expense', 'uncategorizedExpense'],
  ['7000', '수취 이자', 'otherIncome'],
  ['7100', '기타 수익', 'otherIncome'],
  ['8000', '계좌 대조 조정', 'otherExpense', 'reconDiscrepancy'],
];

/** Build account records for a new company. `makeId` supplies ids. */
export function defaultAccounts(makeId, now = Date.now()) {
  return DEFAULT_CHART.map(([number, name, type, role, description]) => ({
    id: makeId(),
    number,
    name,
    type,
    role: role || null,
    description: description || '',
    parentId: null,
    active: true,
    createdAt: now,
  }));
}

/** "1000 Checking" or "Checking", with the parent path: "Utilities:Electric". */
export function accountLabel(account, byId, { withNumber = true } = {}) {
  if (!account) return '';
  const names = [account.name];
  let p = account.parentId && byId ? byId.get(account.parentId) : null;
  let guard = 0;
  while (p && guard++ < 10) {
    names.unshift(p.name);
    p = p.parentId ? byId.get(p.parentId) : null;
  }
  const full = names.join(':');
  return withNumber && account.number ? `${account.number} ${full}` : full;
}

/**
 * Accounts in chart order: by type order, then number, then name, with each
 * sub-account directly under its parent. Returns [{ account, depth }].
 */
export function sortChart(accounts) {
  const byParent = new Map();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) {
    const parent = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(a);
  }
  const cmp = (a, b) =>
    typeInfo(a.type).order - typeInfo(b.type).order ||
    (a.number || '').localeCompare(b.number || '', undefined, { numeric: true }) ||
    a.name.localeCompare(b.name);
  for (const list of byParent.values()) list.sort(cmp);
  const out = [];
  const walk = (parent, depth) => {
    for (const a of byParent.get(parent) || []) {
      out.push({ account: a, depth });
      if (depth < 8) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Ids of an account and all its descendants. */
export function descendantIds(accountId, accounts) {
  const out = new Set([accountId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) {
        out.add(a.id);
        grew = true;
      }
    }
  }
  return out;
}
