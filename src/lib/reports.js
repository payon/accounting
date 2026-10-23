/**
 * Financial reports, computed from the ledger.
 *
 * Every report returns the same shape so one renderer, one CSV exporter and
 * one print stylesheet serve them all:
 *
 *   { id, title, subtitle, columns: [{ key, label, align }],
 *     rows: [{ kind, label, depth, values: [...], accountId?, txnId?, group?, drill? }],
 *     notes? }
 *
 * kind is one of 'section' (a heading that can collapse), 'account' (a data
 * row), 'subtotal' (Total for X), 'total' (a section total), 'grand' (the
 * bottom line), 'spacer', or 'row' (a plain listing row).
 */
import { ACCOUNT_TYPES, typeInfo, isBalanceSheet } from './accounts.js';
import { addDays, dayNum, fromDayNum, diffDays, formatRange, formatDateLong, fiscalYearStart, monthBuckets, quarterBuckets, yearBuckets, addYears, addMonths, startOfMonth, endOfMonth, startOfQuarter } from './dates.js';
import { TXN_TYPES, typeLabel, taxRateOf } from './txn.js';

export const REPORTS = [
  { id: 'pnl', title: '손익계산서', group: '재무제표', desc: '한 기간의 수익, 비용과 당기순이익입니다.' },
  { id: 'bs', title: '재무상태표', group: '재무제표', desc: '특정 날짜의 자산과 부채입니다.' },
  { id: 'cf', title: '현금흐름표', group: '재무제표', desc: '현금의 출처와 용도입니다.' },
  { id: 'pnlMonthly', title: '월별 손익계산서', group: '재무제표', desc: '월별로 한 칸씩 나눈 손익계산서입니다.' },
  { id: 'pnlCompare', title: '손익계산서 비교', group: '재무제표', desc: '당기와 지난해 같은 기간을 나란히 비교합니다.' },
  { id: 'bsCompare', title: '재무상태표 비교', group: '재무제표', desc: '1년 전 재무상태표와 나란히 비교합니다.' },
  { id: 'arAging', title: '미수금 에이징', group: '미수금', desc: '고객별·연체별 미결 청구서입니다.' },
  { id: 'arAgingDetail', title: '미수금 에이징 상세', group: '미수금', desc: '연체 구간별 미결 청구서입니다.' },
  { id: 'customerBalance', title: '고객 잔액', group: '미수금', desc: '고객별 미수 금액입니다.' },
  { id: 'openInvoices', title: '미결 청구서', group: '미수금', desc: '미수 잔액이 있는 모든 청구서입니다.' },
  { id: 'salesByCustomer', title: '고객별 매출', group: '매출', desc: '고객별 수익입니다.' },
  { id: 'salesByItem', title: '품목별 매출', group: '매출', desc: '품목별 판매 수량과 금액입니다.' },
  { id: 'apAging', title: '미지급금 에이징', group: '미지급금', desc: '공급처별·연체별 미결 지출결의서입니다.' },
  { id: 'apAgingDetail', title: '미지급금 에이징 상세', group: '미지급금', desc: '연체 구간별 미결 지출결의서입니다.' },
  { id: 'vendorBalance', title: '공급처 잔액', group: '미지급금', desc: '공급처별 미지급 금액입니다.' },
  { id: 'unpaidBills', title: '미지급 지출결의서', group: '미지급금', desc: '미지급 잔액이 있는 모든 지출결의서입니다.' },
  { id: 'expensesByVendor', title: '공급처별 지출', group: '매입', desc: '공급처별 지출 금액입니다.' },
  { id: 'salesTax', title: '부가세 납부의무', group: '부가세', desc: '과세 매출과 세율별 징수 세액입니다.' },
  { id: 'gl', title: '총계정원장', group: '원장 및 감사', desc: '계정별 모든 분개와 누적 잔액입니다.' },
  { id: 'tb', title: '시산표', group: '원장 및 감사', desc: '모든 계정의 차변·대변 잔액입니다.' },
  { id: 'journal', title: '일반 분개', group: '원장 및 감사', desc: '차변과 대변을 포함한 모든 거래입니다.' },
  { id: 'txnList', title: '거래 목록', group: '원장 및 감사', desc: '한 기간의 모든 거래입니다.' },
  { id: 'accountList', title: '계정 목록', group: '원장 및 감사', desc: '잔액이 포함된 계정과목표입니다.' },
  { id: 'reconDiscrepancy', title: '계좌 대조 후 변경 내역', group: '원장 및 감사', desc: '계좌 대조 이후 변경된 대조 완료 거래입니다.' },
];

export function reportMeta(id) {
  return REPORTS.find((r) => r.id === id);
}

/** Which controls a report's toolbar shows. */
export function reportControls(id) {
  const asOf = ['bs', 'bsCompare', 'arAging', 'arAgingDetail', 'apAging', 'apAgingDetail', 'customerBalance', 'vendorBalance', 'tb', 'accountList', 'openInvoices', 'unpaidBills'].includes(id);
  const basis = ['pnl', 'pnlMonthly', 'pnlCompare', 'bs', 'bsCompare', 'tb', 'gl', 'salesByCustomer', 'expensesByVendor', 'journal'].includes(id);
  const columns = ['pnl', 'bs'].includes(id);
  return { asOf, basis, columns, range: !asOf };
}

// --------------------------------------------------------------- helpers

function names(store) {
  return {
    account: (id) => store.accountName(id),
    contact: (id) => store.contactName(id),
  };
}

/**
 * Turn per-account values (natural sign) for a set of account types into
 * hierarchical rows with "Total for" subtotals, plus the section total.
 * `valuesFor(accountId)` returns an array of numbers (one per column).
 */
function accountTree(store, types, valuesFor, ncols, { showZero = false } = {}) {
  const chart = store.chart({ includeInactive: true }).filter((r) => types.includes(r.account.type));
  const byParent = new Map();
  for (const r of chart) {
    const p = r.account.parentId && chart.some((x) => x.account.id === r.account.parentId) ? r.account.parentId : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(r.account);
  }
  const rows = [];
  const total = new Array(ncols).fill(0);
  const walk = (parentId, depth) => {
    const acc = new Array(ncols).fill(0);
    for (const a of byParent.get(parentId) || []) {
      const own = valuesFor(a.id);
      const children = byParent.get(a.id);
      if (children?.length) {
        const saved = rows.length;
        const sub = walk(a.id, depth + 1);
        const combined = own.map((v, i) => v + sub[i]);
        const nonZero = combined.some((v) => v !== 0) || showZero;
        if (nonZero) {
          const header = { kind: 'section', label: store.accountName(a.id, { withNumber: true }).split(':').pop(), depth, values: own.some((v) => v) ? own : new Array(ncols).fill(null), accountId: a.id, group: `acct-${a.id}`, drill: { accountId: a.id, own: true } };
          rows.splice(saved, 0, header);
          rows.push({ kind: 'subtotal', label: `${a.name} 합계`, depth, values: combined, accountId: a.id, group: `acct-${a.id}`, drill: { accountId: a.id } });
        } else {
          rows.length = saved;
        }
        for (let i = 0; i < ncols; i++) acc[i] += combined[i];
      } else {
        if (own.some((v) => v !== 0) || showZero) rows.push({ kind: 'account', label: store.accountName(a.id).split(':').pop(), depth, values: own, accountId: a.id, drill: { accountId: a.id } });
        for (let i = 0; i < ncols; i++) acc[i] += own[i];
      }
    }
    return acc;
  };
  const t = walk(null, 1);
  for (let i = 0; i < ncols; i++) total[i] = t[i];
  return { rows, total };
}

function columnsFor(from, to, mode, fiscalStartMonth) {
  if (mode === 'month') return monthBuckets(from, to);
  if (mode === 'quarter') return quarterBuckets(from, to);
  if (mode === 'year') return yearBuckets(from, to, fiscalStartMonth);
  return [{ key: 'total', from, to, label: '합계' }];
}

function signed(store, accountIdx, value) {
  const id = store.ledger().accountIds[accountIdx];
  return value * typeInfo(store.account(id)?.type).sign;
}

function natural(store, L, activity) {
  const m = new Map();
  for (let i = 0; i < L.accountIds.length; i++) {
    const id = L.accountIds[i];
    const a = store.account(id);
    if (!a) continue;
    m.set(id, activity[i] * typeInfo(a.type).sign);
  }
  return m;
}

// ------------------------------------------------------------ P&L

/**
 * Profit and Loss. Columns are period buckets (or one total), optionally with
 * a comparison period and a change column.
 */
export function profitAndLoss(store, { from, to, basis = 'accrual', columns = 'total', compare = null } = {}) {
  const L = store.ledger(basis);
  // "All dates" split into columns spans the books' own first and last day.
  if ((columns !== 'total' || compare) && (!from || !to) && L.size) {
    from = from || fromDayNum(L.day[0]);
    to = to || fromDayNum(L.day[L.size - 1]);
  }
  let buckets = columnsFor(from || '1970-01-01', to, columns, store.settings.fiscalStartMonth);
  if (columns !== 'total' && buckets.length > 1) buckets = [...buckets, { key: 'total', from, to, label: '합계' }];
  if (compare) {
    const prev = compare === 'prevYear' ? { from: addYears(from, -1), to: yearBefore(to) } : previousPeriod(from, to);
    buckets = [
      { key: 'cur', from, to, label: formatRange(from, to) },
      { key: 'prev', from: prev.from, to: prev.to, label: formatRange(prev.from, prev.to) },
    ];
  }
  const acts = buckets.map((b) => natural(store, L, L.activity(b.from, b.to)));
  const n = buckets.length;
  const vals = (id) => acts.map((m) => m.get(id) || 0);

  const rows = [];
  const section = (label, types, group) => {
    const tree = accountTree(store, types, vals, n);
    rows.push({ kind: 'section', label, depth: 0, values: new Array(n).fill(null), group });
    rows.push(...tree.rows.map((r) => ({ ...r, parent: group })));
    rows.push({ kind: 'total', label: `${label} 합계`, depth: 0, values: tree.total, group });
    return tree.total;
  };
  const income = section('수익', ['income'], 'income');
  const cogs = section('매출원가', ['cogs'], 'cogs');
  const gross = income.map((v, i) => v - cogs[i]);
  rows.push({ kind: 'grand', label: '매출총이익', depth: 0, values: gross });
  const expenses = section('비용', ['expense'], 'expenses');
  const operating = gross.map((v, i) => v - expenses[i]);
  rows.push({ kind: 'grand', label: '영업이익', depth: 0, values: operating });
  const otherIncome = section('기타 수익', ['otherIncome'], 'otherIncome');
  const otherExpense = section('기타 비용', ['otherExpense'], 'otherExpense');
  const otherNet = otherIncome.map((v, i) => v - otherExpense[i]);
  rows.push({ kind: 'grand', label: '기타 순수익', depth: 0, values: otherNet });
  const net = operating.map((v, i) => v + otherNet[i]);
  rows.push({ kind: 'grand', label: '당기순이익', depth: 0, values: net, emphasis: true });

  const cols = buckets.map((b) => ({ key: b.key, label: b.label, align: 'right', from: b.from, to: b.to }));
  if (compare) {
    cols.push({ key: 'change', label: '금액 변화', align: 'right' }, { key: 'pct', label: '비율 변화', align: 'right', percent: true });
    for (const r of rows) {
      if (!r.values || r.values[0] === null) { r.values = [...(r.values || []), null, null]; continue; }
      const [c, p] = r.values;
      r.values = [c, p, c - p, p ? Math.round(((c - p) / Math.abs(p)) * 10000) : null];
    }
  }
  return {
    id: 'pnl',
    title: '손익계산서',
    subtitle: formatRange(from, to),
    basis,
    columns: [{ key: 'label', label: '' }, ...cols],
    rows: trimEmptySections(rows),
    net: net[compare ? 0 : n - 1],
  };
}

/** The same day a year earlier; a month end maps to that month's end, so Feb 28, 2025 maps to Feb 29, 2024. */
export function yearBefore(iso) {
  return iso === endOfMonth(iso) ? endOfMonth(addYears(iso, -1)) : addYears(iso, -1);
}

/**
 * The period just before [from, to]. Whole calendar months (a month, a
 * quarter, a year) step back by whole months, so September compares with all
 * of August; any other range steps back by its own length in days.
 */
export function previousPeriod(from, to) {
  if (from === startOfMonth(from) && to === endOfMonth(to)) {
    const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;
    return { from: addMonths(from, -months), to: endOfMonth(addMonths(startOfMonth(to), -months)) };
  }
  const days = diffDays(to, from) + 1;
  return { from: addDays(from, -days), to: addDays(to, -days) };
}

/** Drop sections with no rows and zero totals (an empty "Other Expenses"). */
function trimEmptySections(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'section' && r.depth === 0) {
      let j = i + 1;
      while (j < rows.length && !(rows[j].kind === 'total' && rows[j].group === r.group && rows[j].depth === 0)) j++;
      const body = rows.slice(i + 1, j);
      const tot = rows[j];
      if (!body.length && tot && tot.values.every((v) => !v)) {
        i = j;
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

// --------------------------------------------------------- Balance sheet

/** Net income (natural sign) for a range from a ledger. */
function netIncome(store, L, from, to) {
  const act = L.activity(from, to);
  let total = 0;
  for (let i = 0; i < L.accountIds.length; i++) {
    const a = store.account(L.accountIds[i]);
    if (!a || isBalanceSheet(a.type)) continue;
    total -= act[i]; // income is a credit (negative); net income is minus the P&L sum
  }
  return total;
}

function balanceSheetValues(store, L, asOf) {
  const fyStart = fiscalYearStart(asOf, store.settings.fiscalStartMonth);
  const bal = L.balancesAsOf(asOf);
  const map = natural(store, L, bal);
  const priorNet = netIncome(store, L, null, addDays(fyStart, -1));
  const currentNet = netIncome(store, L, fyStart, asOf);
  return { map, priorNet, currentNet };
}

export function balanceSheet(store, { asOf, basis = 'accrual', compare = null, columns = 'total' } = {}) {
  const L = store.ledger(basis);
  let dates = [{ key: 'total', asOf, label: '합계' }];
  if (compare === 'prevYear') dates = [{ key: 'cur', asOf, label: formatDateLong(asOf) }, { key: 'prev', asOf: yearBefore(asOf), label: formatDateLong(yearBefore(asOf)) }];
  else if (columns === 'month' || columns === 'quarter') {
    const step = columns === 'month' ? 1 : 3;
    // Earlier columns are the ends of the months (or quarters) before asOf's.
    const base = columns === 'month' ? startOfMonth(asOf) : startOfQuarter(asOf);
    dates = [];
    for (let k = 5; k >= 0; k--) {
      const d = k === 0 ? asOf : addDays(addMonths(base, -(k - 1) * step), -1);
      dates.push({ key: `d${k}`, asOf: d, label: formatDateLong(d) });
    }
  }
  const vals = dates.map((d) => balanceSheetValues(store, L, d.asOf));
  const n = dates.length;
  const re = store.roleMap().get('retainedEarnings');
  const valuesFor = (id) => vals.map((v) => (v.map.get(id) || 0) + (id === re ? v.priorNet : 0));

  const rows = [];
  const group = (label, types, key, depth = 1) => {
    const tree = accountTree(store, types, valuesFor, n);
    if (!tree.rows.length && tree.total.every((v) => !v)) return tree.total;
    rows.push({ kind: 'section', label, depth, values: new Array(n).fill(null), group: key });
    rows.push(...tree.rows.map((r) => ({ ...r, depth: r.depth + depth })));
    rows.push({ kind: 'subtotal', label: `${label} 합계`, depth, values: tree.total, group: key });
    return tree.total;
  };
  const add = (...arrs) => arrs[0].map((_, i) => arrs.reduce((s, a) => s + a[i], 0));

  rows.push({ kind: 'section', label: '자산', depth: 0, values: new Array(n).fill(null), group: 'assets' });
  rows.push({ kind: 'section', label: '유동자산', depth: 1, values: new Array(n).fill(null), group: 'curA' });
  const bank = group('은행 계좌', ['bank'], 'bank', 2);
  const ar = group('외상매출금', ['ar'], 'ar', 2);
  const oca = group('기타 유동자산', ['otherCurrentAsset'], 'oca', 2);
  const current = add(bank, ar, oca);
  rows.push({ kind: 'subtotal', label: '유동자산 합계', depth: 1, values: current, group: 'curA' });
  const fixed = group('고정자산', ['fixedAsset'], 'fixed');
  const other = group('기타 자산', ['otherAsset'], 'otherAssets');
  const assets = add(current, fixed, other);
  rows.push({ kind: 'total', label: '자산 합계', depth: 0, values: assets, emphasis: true, group: 'assets' });

  rows.push({ kind: 'section', label: '부채와 자본', depth: 0, values: new Array(n).fill(null), group: 'le' });
  rows.push({ kind: 'section', label: '부채', depth: 1, values: new Array(n).fill(null), group: 'liab' });
  rows.push({ kind: 'section', label: '유동부채', depth: 2, values: new Array(n).fill(null), group: 'curL' });
  const ap = group('외상매입금', ['ap'], 'ap', 3);
  const cc = group('신용카드', ['creditCard'], 'cc', 3);
  const ocl = group('기타 유동부채', ['otherCurrentLiability'], 'ocl', 3);
  const curLiab = add(ap, cc, ocl);
  rows.push({ kind: 'subtotal', label: '유동부채 합계', depth: 2, values: curLiab, group: 'curL' });
  const ltl = group('장기부채', ['longTermLiability'], 'ltl', 2);
  const liabilities = add(curLiab, ltl);
  rows.push({ kind: 'subtotal', label: '부채 합계', depth: 1, values: liabilities, group: 'liab' });

  rows.push({ kind: 'section', label: '자본', depth: 1, values: new Array(n).fill(null), group: 'equity' });
  const eqTree = accountTree(store, ['equity'], valuesFor, n, { showZero: false });
  rows.push(...eqTree.rows.map((r) => ({ ...r, depth: r.depth + 1 })));
  const ni = vals.map((v) => v.currentNet);
  rows.push({ kind: 'account', label: '당기순이익', depth: 2, values: ni, drill: { report: 'pnl' } });
  const equity = add(eqTree.total, ni);
  rows.push({ kind: 'subtotal', label: '자본 합계', depth: 1, values: equity, group: 'equity' });
  const le = add(liabilities, equity);
  rows.push({ kind: 'total', label: '부채와 자본 합계', depth: 0, values: le, emphasis: true, group: 'le' });

  const balanced = assets.every((v, i) => v === le[i]);
  return {
    id: 'bs',
    title: '재무상태표',
    subtitle: `${formatDateLong(asOf)} 기준`,
    basis,
    columns: [{ key: 'label', label: '' }, ...dates.map((d) => ({ key: d.key, label: d.label, align: 'right' }))],
    rows,
    balanced,
    totals: { assets: assets[0], liabilities: liabilities[0], equity: equity[0] },
  };
}

// ------------------------------------------------------------ Trial balance

export function trialBalance(store, { asOf, basis = 'accrual' } = {}) {
  const L = store.ledger(basis);
  const fyStart = fiscalYearStart(asOf, store.settings.fiscalStartMonth);
  const bsBal = L.balancesAsOf(asOf);
  const plBal = L.activity(fyStart, asOf);
  const priorPL = L.activity(null, addDays(fyStart, -1));
  const re = store.roleMap().get('retainedEarnings');
  let priorSum = 0;
  for (let i = 0; i < L.accountIds.length; i++) {
    const a = store.account(L.accountIds[i]);
    if (a && !isBalanceSheet(a.type)) priorSum += priorPL[i];
  }
  const rows = [];
  let debits = 0;
  let credits = 0;
  for (const { account: a } of store.chart({ includeInactive: true })) {
    const i = L.accountIndex.get(a.id);
    let v = i === undefined ? 0 : isBalanceSheet(a.type) ? bsBal[i] : plBal[i];
    if (a.id === re) v += priorSum;
    if (!v) continue;
    const d = v > 0 ? v : 0;
    const c = v < 0 ? -v : 0;
    debits += d;
    credits += c;
    rows.push({ kind: 'account', label: store.accountName(a.id), depth: 0, values: [d || null, c || null], accountId: a.id, drill: { accountId: a.id } });
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [debits, credits], emphasis: true });
  return {
    id: 'tb',
    title: '시산표',
    subtitle: `${formatDateLong(asOf)} 기준`,
    basis,
    columns: [{ key: 'label', label: '' }, { key: 'debit', label: '차변', align: 'right' }, { key: 'credit', label: '대변', align: 'right' }],
    rows,
    balanced: debits === credits,
  };
}

// ------------------------------------------------------------ General ledger

function splitLabel(store, L, txnIdx, accountId) {
  // The "other side": the one other account, or "-Split-" when there are several.
  const t = L.txns[txnIdx];
  const others = new Set();
  for (const p of store.ledgerPostingsOf(t, L.basis)) if (p.accountId !== accountId) others.add(p.accountId);
  if (others.size === 0) return '';
  if (others.size === 1) return store.accountName([...others][0]);
  return '-분개-';
}

export function generalLedger(store, { from, to, basis = 'accrual', accountIds = null } = {}) {
  const L = store.ledger(basis);
  const rows = [];
  const chart = store.chart({ includeInactive: true }).map((r) => r.account).filter((a) => !accountIds || accountIds.includes(a.id));
  const fyStart = from ? fiscalYearStart(from, store.settings.fiscalStartMonth) : null;
  for (const a of chart) {
    const reg = L.register([a.id], { from, to });
    // P&L accounts start each fiscal year at zero.
    let opening = reg.opening;
    if (!isBalanceSheet(a.type) && from) opening = L.sumAccount(a.id, fyStart, addDays(from, -1));
    if (!reg.rows.length && !opening) continue;
    const sign = typeInfo(a.type).sign;
    rows.push({ kind: 'section', label: store.accountName(a.id), depth: 0, values: new Array(8).fill(null), group: `gl-${a.id}`, accountId: a.id });
    if (from) rows.push({ kind: 'row', label: '기초 잔액', depth: 1, values: [null, null, null, null, null, null, null, opening * sign], muted: true });
    let running = opening;
    for (const r of reg.rows) {
      running += r.amount;
      const t = r.txn;
      rows.push({
        kind: 'row', depth: 1, label: '', txnId: t.id,
        values: [t.date, typeLabel(t.type), t.num || '', store.contactName(t.contactId) || '', r.memo || t.memo || '', splitLabel(store, L, r.txnIdx, a.id), r.amount * sign, running * sign],
      });
    }
    rows.push({ kind: 'subtotal', label: `${store.accountName(a.id)} 합계`, depth: 0, values: [null, null, null, null, null, null, (running - opening) * sign, running * sign], group: `gl-${a.id}` });
  }
  return {
    id: 'gl',
    title: '총계정원장',
    subtitle: formatRange(from, to),
    basis,
    columns: [
      { key: 'label', label: '' },
      { key: 'date', label: '날짜', date: true },
      { key: 'type', label: '거래 유형' },
      { key: 'num', label: '번호' },
      { key: 'name', label: '이름' },
      { key: 'memo', label: '메모/설명' },
      { key: 'split', label: '상대계정' },
      { key: 'amount', label: '금액', align: 'right' },
      { key: 'balance', label: '잔액', align: 'right' },
    ],
    rows,
  };
}

// --------------------------------------------------------------- Cash flow

export function cashFlow(store, { from, to } = {}) {
  const L = store.ledger('accrual');
  const act = L.activity(from, to);
  const rows = [];
  const ni = netIncome(store, L, from, to);
  rows.push({ kind: 'section', label: '영업활동', depth: 0, values: [null], group: 'op' });
  rows.push({ kind: 'account', label: '당기순이익', depth: 1, values: [ni], drill: { report: 'pnl' } });
  const buckets = { op: [], inv: [], fin: [] };
  let cashChange = 0;
  for (const { account: a } of store.chart({ includeInactive: true })) {
    const i = L.accountIndex.get(a.id);
    if (i === undefined || !isBalanceSheet(a.type)) continue;
    const v = act[i];
    if (a.type === 'bank') { cashChange += v; continue; }
    if (!v) continue;
    const group = a.type === 'fixedAsset' || a.type === 'otherAsset' ? 'inv' : a.type === 'longTermLiability' || a.type === 'equity' ? 'fin' : 'op';
    buckets[group].push({ kind: 'account', label: store.accountName(a.id), depth: 2, values: [-v], accountId: a.id, drill: { accountId: a.id } });
  }
  const total = (list) => list.reduce((s, r) => s + r.values[0], 0);
  if (buckets.op.length) {
    rows.push({ kind: 'section', label: '당기순이익을 영업활동 현금흐름과 대사하기 위한 조정', depth: 1, values: [null], group: 'adj' });
    rows.push(...buckets.op);
    rows.push({ kind: 'subtotal', label: '조정 합계', depth: 1, values: [total(buckets.op)], group: 'adj' });
  }
  const op = ni + total(buckets.op);
  rows.push({ kind: 'total', label: '영업활동으로 인한 순현금흐름', depth: 0, values: [op], group: 'op' });
  rows.push({ kind: 'section', label: '투자활동', depth: 0, values: [null], group: 'inv' });
  rows.push(...buckets.inv.map((r) => ({ ...r, depth: 1 })));
  rows.push({ kind: 'total', label: '투자활동으로 인한 순현금흐름', depth: 0, values: [total(buckets.inv)], group: 'inv' });
  rows.push({ kind: 'section', label: '재무활동', depth: 0, values: [null], group: 'fin' });
  rows.push(...buckets.fin.map((r) => ({ ...r, depth: 1 })));
  rows.push({ kind: 'total', label: '재무활동으로 인한 순현금흐름', depth: 0, values: [total(buckets.fin)], group: 'fin' });
  const net = op + total(buckets.inv) + total(buckets.fin);
  rows.push({ kind: 'grand', label: '당기 순현금 증가', depth: 0, values: [net] });
  let begin = 0;
  if (from) {
    const bal = L.balancesAsOf(addDays(from, -1));
    for (const { account: a } of store.chart({ includeInactive: true })) {
      if (a.type !== 'bank') continue;
      const i = L.accountIndex.get(a.id);
      if (i !== undefined) begin += bal[i];
    }
  }
  rows.push({ kind: 'account', label: '기초 현금', depth: 0, values: [begin] });
  rows.push({ kind: 'grand', label: '기말 현금', depth: 0, values: [begin + net], emphasis: true });
  return {
    id: 'cf',
    title: '현금흐름표',
    subtitle: formatRange(from, to),
    columns: [{ key: 'label', label: '' }, { key: 'total', label: '합계', align: 'right' }],
    rows,
    check: { net, cashChange },
  };
}

// ------------------------------------------------------------------ Aging

export const AGING_BUCKETS = ['기일 내', '1 - 30', '31 - 60', '61 - 90', '91 이상'];

function bucketOf(daysPastDue) {
  if (daysPastDue <= 0) return 0;
  if (daysPastDue <= 30) return 1;
  if (daysPastDue <= 60) return 2;
  if (daysPastDue <= 90) return 3;
  return 4;
}

/**
 * Open documents as of a date: the document total less settlements dated on
 * or before that date, plus unapplied credits (shown as negative, current).
 * Anything else posted to A/R or A/P (a journal entry writing off a balance,
 * a deposit line) is an open item of its own, so the totals tie to the ledger.
 * Each item carries the contact it belongs to.
 */
export function openItemsAsOf(store, side, asOf) {
  const docType = side === 'ar' ? 'invoice' : 'bill';
  const creditTypes = side === 'ar' ? ['payment', 'creditMemo'] : ['billPayment', 'vendorCredit'];
  const info = store.docInfo();
  const out = [];
  const L = store.ledger('accrual');
  const ai = L.accountIndex.get(store.roleMap().get(side));
  if (ai !== undefined) {
    const idx = L.byAccount(ai);
    const toDay = dayNum(asOf);
    const other = new Map();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (L.day[i] > toDay) break;
      const t = L.txns[L.txn[i]];
      if (t.type === docType || creditTypes.includes(t.type)) continue;
      const key = `${L.txn[i]}|${L.contact[i]}`;
      const e = other.get(key);
      if (e) e.amount += L.amt[i];
      else other.set(key, { txn: t, contactId: L.contact[i] >= 0 ? L.contactIds[L.contact[i]] : null, amount: L.amt[i] });
    }
    for (const { txn, contactId, amount } of other.values()) {
      const open = side === 'ar' ? amount : -amount;
      if (open) out.push({ txn, contactId, open, total: open, due: txn.date, credit: open < 0 });
    }
  }
  for (const t of store.txns.values()) {
    if (t.voided || t.date > asOf) continue;
    if (t.type === docType) {
      const total = info.totals.get(t.id) || 0;
      const settled = (info.links.get(t.id) || []).reduce((s, l) => {
        const src = store.txn(l.txnId);
        return src && src.date <= asOf ? s + l.amount : s;
      }, 0);
      const open = total - settled;
      if (open) out.push({ txn: t, contactId: t.contactId || null, open, total, due: t.dueDate || t.date });
    } else if (creditTypes.includes(t.type)) {
      const total = info.totals.get(t.id) || 0;
      const used = (t.applied || []).reduce((s, a) => {
        const target = store.txn(a.txnId);
        return target && target.date <= asOf ? s + Math.round(a.amount || 0) : s;
      }, 0);
      const open = total - used;
      if (open > 0) out.push({ txn: t, contactId: t.contactId || null, open: -open, total: -total, due: t.date, credit: true });
    }
  }
  return out;
}

export function agingSummary(store, { asOf, side = 'ar' } = {}) {
  const items = openItemsAsOf(store, side, asOf);
  const by = new Map();
  for (const it of items) {
    const id = it.contactId || '';
    if (!by.has(id)) by.set(id, [0, 0, 0, 0, 0]);
    const b = it.credit ? 0 : bucketOf(diffDays(asOf, it.due));
    by.get(id)[b] += it.open;
  }
  const rows = [];
  const totals = [0, 0, 0, 0, 0, 0];
  const list = [...by.entries()].map(([id, v]) => ({ id, name: store.contactName(id) || '이름 없음', v })).sort((a, b) => a.name.localeCompare(b.name));
  for (const { id, name, v } of list) {
    const total = v.reduce((s, x) => s + x, 0);
    if (!total && v.every((x) => !x)) continue;
    v.forEach((x, i) => { totals[i] += x; });
    totals[5] += total;
    rows.push({ kind: 'account', label: name, depth: 0, values: [...v.map((x) => x || null), total], contactId: id, drill: { contactId: id } });
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: totals, emphasis: true });
  return {
    id: side === 'ar' ? 'arAging' : 'apAging',
    title: side === 'ar' ? '미수금 에이징' : '미지급금 에이징',
    subtitle: `${formatDateLong(asOf)} 기준`,
    columns: [{ key: 'label', label: '' }, ...AGING_BUCKETS.map((b, i) => ({ key: `b${i}`, label: b, align: 'right' })), { key: 'total', label: '합계', align: 'right' }],
    rows,
  };
}

export function agingDetail(store, { asOf, side = 'ar' } = {}) {
  const items = openItemsAsOf(store, side, asOf).filter((x) => !x.credit);
  const groups = [[], [], [], [], []];
  for (const it of items) groups[bucketOf(diffDays(asOf, it.due))].push(it);
  const rows = [];
  const labels = ['기일 내', '1 - 30일 연체', '31 - 60일 연체', '61 - 90일 연체', '91일 이상 연체'];
  let grand = 0;
  groups.forEach((g, gi) => {
    if (!g.length) return;
    g.sort((a, b) => a.due.localeCompare(b.due));
    rows.push({ kind: 'section', label: labels[gi], depth: 0, values: [null, null, null, null, null, null, null], group: `age-${gi}` });
    let total = 0;
    for (const it of g) {
      total += it.open;
      rows.push({ kind: 'row', depth: 1, label: '', txnId: it.txn.id, values: [it.txn.date, typeLabel(it.txn.type), it.txn.num || '', store.contactName(it.contactId), it.due, Math.max(0, diffDays(asOf, it.due)), it.open] });
    }
    grand += total;
    rows.push({ kind: 'subtotal', label: `${labels[gi]} 합계`, depth: 0, values: [null, null, null, null, null, null, total], group: `age-${gi}` });
  });
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [null, null, null, null, null, null, grand], emphasis: true });
  return {
    id: side === 'ar' ? 'arAgingDetail' : 'apAgingDetail',
    title: side === 'ar' ? '미수금 에이징 상세' : '미지급금 에이징 상세',
    subtitle: `${formatDateLong(asOf)} 기준`,
    columns: [
      { key: 'label', label: '' }, { key: 'date', label: '날짜', date: true }, { key: 'type', label: '거래 유형' }, { key: 'num', label: '번호' },
      { key: 'name', label: side === 'ar' ? '고객' : '공급처' }, { key: 'due', label: '만기일', date: true }, { key: 'pastDue', label: '연체', align: 'right', integer: true },
      { key: 'open', label: '미결 잔액', align: 'right' },
    ],
    rows,
  };
}

export function openDocsReport(store, { asOf, side = 'ar' } = {}) {
  const items = openItemsAsOf(store, side, asOf).filter((x) => !x.credit);
  const by = new Map();
  for (const it of items) {
    const id = it.contactId || '';
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(it);
  }
  const rows = [];
  let grand = 0;
  const list = [...by.entries()].sort((a, b) => store.contactName(a[0]).localeCompare(store.contactName(b[0])));
  for (const [cid, docs] of list) {
    rows.push({ kind: 'section', label: store.contactName(cid) || '이름 없음', depth: 0, values: [null, null, null, null, null, null], group: `od-${cid}` });
    let total = 0;
    for (const it of docs.sort((a, b) => a.txn.date.localeCompare(b.txn.date))) {
      total += it.open;
      rows.push({ kind: 'row', depth: 1, label: '', txnId: it.txn.id, values: [it.txn.date, typeLabel(it.txn.type), it.txn.num || '', it.due, it.total, it.open] });
    }
    grand += total;
    rows.push({ kind: 'subtotal', label: `${store.contactName(cid) || '이름 없음'} 합계`, depth: 0, values: [null, null, null, null, null, total], group: `od-${cid}` });
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [null, null, null, null, null, grand], emphasis: true });
  return {
    id: side === 'ar' ? 'openInvoices' : 'unpaidBills',
    title: side === 'ar' ? '미결 청구서' : '미지급 지출결의서',
    subtitle: `${formatDateLong(asOf)} 기준`,
    columns: [
      { key: 'label', label: '' }, { key: 'date', label: '날짜', date: true }, { key: 'type', label: '거래 유형' }, { key: 'num', label: '번호' },
      { key: 'due', label: '만기일', date: true }, { key: 'amount', label: '금액', align: 'right' }, { key: 'open', label: '미결 잔액', align: 'right' },
    ],
    rows,
  };
}

export function contactBalanceSummary(store, { asOf, side = 'ar' } = {}) {
  const items = openItemsAsOf(store, side, asOf);
  const by = new Map();
  for (const it of items) by.set(it.contactId || '', (by.get(it.contactId || '') || 0) + it.open);
  const rows = [];
  let total = 0;
  for (const [id, v] of [...by.entries()].sort((a, b) => store.contactName(a[0]).localeCompare(store.contactName(b[0])))) {
    if (!v) continue;
    total += v;
    rows.push({ kind: 'account', label: store.contactName(id) || '이름 없음', depth: 0, values: [v], contactId: id, drill: { contactId: id } });
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [total], emphasis: true });
  return {
    id: side === 'ar' ? 'customerBalance' : 'vendorBalance',
    title: side === 'ar' ? '고객 잔액' : '공급처 잔액',
    subtitle: `${formatDateLong(asOf)} 기준`,
    columns: [{ key: 'label', label: '' }, { key: 'total', label: '합계', align: 'right' }],
    rows,
  };
}

// --------------------------------------------------------- Sales / expenses by contact

export function byContactSummary(store, { from, to, basis = 'accrual', side = 'sales' } = {}) {
  const L = store.ledger(basis);
  const types = side === 'sales' ? ['income'] : ['expense', 'cogs', 'otherExpense'];
  const accountFilter = (idx) => {
    const a = store.account(L.accountIds[idx]);
    return a && types.includes(a.type);
  };
  const m = L.byContact(from, to, accountFilter);
  const rows = [];
  let total = 0;
  const list = [...m.entries()].map(([id, accts]) => {
    let v = 0;
    for (const x of accts.values()) v += x;
    return { id, name: id ? store.contactName(id) || '이름 없음' : '지정 안 됨', v: side === 'sales' ? -v : v };
  }).filter((x) => x.v).sort((a, b) => a.name.localeCompare(b.name));
  for (const x of list) {
    total += x.v;
    rows.push({ kind: 'account', label: x.name, depth: 0, values: [x.v], contactId: x.id, drill: { contactId: x.id } });
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [total], emphasis: true });
  return {
    id: side === 'sales' ? 'salesByCustomer' : 'expensesByVendor',
    title: side === 'sales' ? '고객별 매출' : '공급처별 지출',
    subtitle: formatRange(from, to),
    basis,
    columns: [{ key: 'label', label: '' }, { key: 'total', label: '합계', align: 'right' }],
    rows,
  };
}

export function salesByItem(store, { from, to } = {}) {
  const by = new Map();
  const sign = { invoice: 1, salesReceipt: 1, creditMemo: -1, refundReceipt: -1 };
  for (const t of store.txns.values()) {
    if (!sign[t.type] || t.voided) continue;
    if ((from && t.date < from) || (to && t.date > to)) continue;
    for (const l of t.lines || []) {
      const key = l.itemId || '';
      if (!by.has(key)) by.set(key, { qty: 0, amount: 0 });
      const e = by.get(key);
      e.qty += sign[t.type] * (Number(l.qty) || (l.itemId ? 1 : 0));
      e.amount += sign[t.type] * (l.qty !== undefined && l.qty !== '' && l.rate !== undefined && l.rate !== '' ? Math.round(Number(l.qty) * Number(l.rate)) : Math.round(l.amount || 0));
    }
  }
  const rows = [];
  let tq = 0; let ta = 0;
  const list = [...by.entries()].map(([id, v]) => ({ id, name: id ? store.item(id)?.name || '삭제된 품목' : '품목 없음', ...v })).sort((a, b) => a.name.localeCompare(b.name));
  for (const x of list) {
    if (!x.amount && !x.qty) continue;
    tq += x.qty; ta += x.amount;
    rows.push({ kind: 'account', label: x.name, depth: 0, values: [x.qty, x.amount, x.qty ? Math.round(x.amount / x.qty) : null], itemId: x.id });
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [tq, ta, null], emphasis: true });
  return {
    id: 'salesByItem',
    title: '품목별 매출',
    subtitle: formatRange(from, to),
    columns: [{ key: 'label', label: '' }, { key: 'qty', label: '수량', align: 'right', number: true }, { key: 'amount', label: '금액', align: 'right' }, { key: 'avg', label: '평균 단가', align: 'right' }],
    rows,
  };
}

// --------------------------------------------------------------- Sales tax

export function salesTaxLiability(store, { from, to } = {}) {
  const by = new Map();
  const sign = { invoice: 1, salesReceipt: 1, creditMemo: -1, refundReceipt: -1 };
  for (const t of store.txns.values()) {
    if (!sign[t.type] || t.voided) continue;
    if ((from && t.date < from) || (to && t.date > to)) continue;
    const tot = store.salesTotals(t);
    // Documents keep the rate they were saved with, so a rate that changed shows one row per percentage.
    const bp = taxRateOf(t, store.ctx());
    const key = t.taxRateId ? `${t.taxRateId}|${bp}` : '';
    if (!by.has(key)) by.set(key, { id: t.taxRateId || '', bp, total: 0, taxable: 0, tax: 0 });
    const e = by.get(key);
    e.total += sign[t.type] * (tot.subtotal - tot.discount);
    e.taxable += sign[t.type] * (t.taxRateId ? tot.taxableBase : 0);
    e.tax += sign[t.type] * tot.tax;
  }
  const rows = [];
  const totals = [0, 0, 0, 0];
  for (const e of by.values()) {
    const rate = e.id ? store.taxRates.get(e.id) : null;
    const bp = e.bp ?? rate?.rate ?? 0;
    const label = rate ? `${rate.name} (${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%)` : '세율 없음';
    rows.push({ kind: 'account', label, depth: 0, values: [e.total, e.taxable, e.total - e.taxable, e.tax] });
    totals[0] += e.total; totals[1] += e.taxable; totals[2] += e.total - e.taxable; totals[3] += e.tax;
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: totals, emphasis: true });
  const paid = (() => {
    const L = store.ledger('accrual');
    const id = store.roleMap().get('salesTax');
    let v = 0;
    // Only money paid to the agency: reversals from credit memos and refunds are already netted above.
    for (const r of L.rows({ from, to, accounts: [id] })) if (r.amount > 0 && !sign[r.txn.type]) v += r.amount;
    return v;
  })();
  return {
    id: 'salesTax',
    title: '부가세 납부의무',
    subtitle: formatRange(from, to),
    columns: [{ key: 'label', label: '' }, { key: 'total', label: '총 매출', align: 'right' }, { key: 'taxable', label: '과세 금액', align: 'right' }, { key: 'nontax', label: '면세 금액', align: 'right' }, { key: 'tax', label: '세액', align: 'right' }],
    rows,
    notes: [`기간 내 기록된 부가세 납부 및 조정: ${paid ? '' : '없음'}`.trim()],
    taxPaid: paid,
  };
}

// --------------------------------------------------------------- Listings

export function transactionList(store, { from, to } = {}) {
  const rows = [];
  const list = store.txnList((t) => (!from || t.date >= from) && (!to || t.date <= to)).slice().reverse();
  for (const t of list) {
    const primary = store.primaryAccount(t);
    rows.push({ kind: 'row', depth: 0, label: '', txnId: t.id, values: [t.date, typeLabel(t.type), t.num || '', t.voided ? '취소됨' : '', store.contactName(t.contactId), t.memo || '', primary ? store.accountName(primary) : '', store.splitName(t, primary), store.total(t)] });
  }
  return {
    id: 'txnList',
    title: '거래 목록',
    subtitle: formatRange(from, to),
    columns: [
      { key: 'label', label: '', hidden: true }, { key: 'date', label: '날짜', date: true }, { key: 'type', label: '거래 유형' }, { key: 'num', label: '번호' }, { key: 'posting', label: '상태' },
      { key: 'name', label: '이름' }, { key: 'memo', label: '메모/설명' }, { key: 'account', label: '계정' }, { key: 'split', label: '상대계정' }, { key: 'amount', label: '금액', align: 'right' },
    ],
    rows,
  };
}

export function journalReport(store, { from, to, basis = 'accrual' } = {}) {
  const rows = [];
  const list = store.txnList((t) => (!from || t.date >= from) && (!to || t.date <= to) && !TXN_TYPES[t.type].nonPosting).slice().reverse();
  let td = 0; let tc = 0;
  for (const t of list) {
    const ps = store.ledgerPostingsOf(t, basis);
    if (!ps.length) continue;
    let first = true;
    let d = 0; let c = 0;
    for (const p of ps) {
      const debit = p.amount > 0 ? p.amount : null;
      const credit = p.amount < 0 ? -p.amount : null;
      d += debit || 0; c += credit || 0;
      rows.push({ kind: 'row', depth: 0, label: '', txnId: t.id, values: [first ? t.date : null, first ? typeLabel(t.type) : '', first ? t.num || '' : '', store.contactName(p.contactId || t.contactId), p.memo || '', store.accountName(p.accountId), debit, credit] });
      first = false;
    }
    rows.push({ kind: 'subtotal', depth: 0, label: '', values: [null, null, null, null, null, null, d, c] });
    td += d; tc += c;
  }
  rows.push({ kind: 'grand', label: '합계', depth: 0, values: [null, null, null, null, null, null, td, tc], emphasis: true });
  return {
    id: 'journal',
    title: '일반 분개',
    subtitle: formatRange(from, to),
    basis,
    columns: [
      { key: 'label', label: '', hidden: true }, { key: 'date', label: '날짜', date: true }, { key: 'type', label: '거래 유형' }, { key: 'num', label: '번호' }, { key: 'name', label: '이름' },
      { key: 'memo', label: '메모/설명' }, { key: 'account', label: '계정' }, { key: 'debit', label: '차변', align: 'right' }, { key: 'credit', label: '대변', align: 'right' },
    ],
    rows,
  };
}

export function accountListReport(store, { asOf } = {}) {
  const rows = [];
  for (const { account: a, depth } of store.chart({ includeInactive: false })) {
    const showBalance = isBalanceSheet(a.type);
    rows.push({ kind: 'row', depth, label: '', accountId: a.id, values: [store.accountName(a.id), ACCOUNT_TYPES[a.type].label, a.description || '', showBalance ? store.accountBalance(a.id, { asOf, includeSubs: false }) : null] });
  }
  return {
    id: 'accountList',
    title: '계정 목록',
    subtitle: `${formatDateLong(asOf)} 기준`,
    columns: [{ key: 'label', label: '', hidden: true }, { key: 'name', label: '계정' }, { key: 'type', label: '유형' }, { key: 'desc', label: '설명' }, { key: 'balance', label: '잔액', align: 'right' }],
    rows,
  };
}

/**
 * Transactions reconciled and then changed: their amount on the account no
 * longer matches what the reconciliation recorded.
 */
export function reconDiscrepancy(store) {
  const rows = [];
  const L = store.ledger('accrual');
  for (const r of store.recons.values()) {
    if (r.status !== 'done') continue;
    const recorded = r.amounts || {};
    for (const id of r.clearedIds || []) {
      const t = store.txn(id);
      const now = t ? store.ledgerPostingsOf(t, 'accrual').filter((p) => p.accountId === r.accountId).reduce((s, p) => s + p.amount, 0) : 0;
      const was = recorded[id];
      if (was === undefined || was === now) continue;
      rows.push({ kind: 'row', depth: 0, label: '', txnId: t ? id : null, values: [store.accountName(r.accountId), r.statementDate, t ? t.date : '', t ? typeLabel(t.type) : '삭제됨', t?.num || '', was, now, now - was] });
    }
  }
  void L;
  if (!rows.length) rows.push({ kind: 'row', depth: 0, label: '', values: ['변경 내역이 없습니다', null, null, null, null, null, null, null], muted: true });
  return {
    id: 'reconDiscrepancy',
    title: '계좌 대조 후 변경 내역',
    subtitle: '모든 계좌 대조',
    columns: [{ key: 'label', label: '', hidden: true }, { key: 'account', label: '계정' }, { key: 'stmt', label: '거래내역 날짜', date: true }, { key: 'date', label: '날짜', date: true }, { key: 'type', label: '유형' }, { key: 'num', label: '번호' }, { key: 'was', label: '대조 당시 금액', align: 'right' }, { key: 'now', label: '현재 금액', align: 'right' }, { key: 'diff', label: '변화', align: 'right' }],
    rows,
  };
}

/** Run a report by id with toolbar options. */
export function runReport(store, id, opts) {
  const o = { ...opts };
  switch (id) {
    case 'pnl': return profitAndLoss(store, o);
    case 'pnlMonthly': return { ...profitAndLoss(store, { ...o, columns: 'month' }), id: 'pnlMonthly', title: '월별 손익계산서' };
    case 'pnlCompare': return { ...profitAndLoss(store, { ...o, compare: 'prevYear' }), id: 'pnlCompare', title: '손익계산서 비교' };
    case 'bs': return balanceSheet(store, o);
    case 'bsCompare': return { ...balanceSheet(store, { ...o, compare: 'prevYear' }), id: 'bsCompare', title: '재무상태표 비교' };
    case 'cf': return cashFlow(store, o);
    case 'tb': return trialBalance(store, o);
    case 'gl': return generalLedger(store, o);
    case 'arAging': return agingSummary(store, { ...o, side: 'ar' });
    case 'apAging': return agingSummary(store, { ...o, side: 'ap' });
    case 'arAgingDetail': return agingDetail(store, { ...o, side: 'ar' });
    case 'apAgingDetail': return agingDetail(store, { ...o, side: 'ap' });
    case 'openInvoices': return openDocsReport(store, { ...o, side: 'ar' });
    case 'unpaidBills': return openDocsReport(store, { ...o, side: 'ap' });
    case 'customerBalance': return contactBalanceSummary(store, { ...o, side: 'ar' });
    case 'vendorBalance': return contactBalanceSummary(store, { ...o, side: 'ap' });
    case 'salesByCustomer': return byContactSummary(store, { ...o, side: 'sales' });
    case 'expensesByVendor': return byContactSummary(store, { ...o, side: 'expenses' });
    case 'salesByItem': return salesByItem(store, o);
    case 'salesTax': return salesTaxLiability(store, o);
    case 'txnList': return transactionList(store, o);
    case 'journal': return journalReport(store, o);
    case 'accountList': return accountListReport(store, o);
    case 'reconDiscrepancy': return reconDiscrepancy(store, o);
    default: throw new Error(`알 수 없는 보고서: ${id}`);
  }
}

export { dayNum, signed };
