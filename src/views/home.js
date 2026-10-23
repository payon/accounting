/** Home: what needs attention, and the business at a glance. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { selectInput } from '../ui/fields.js';
import { columnChart, donutChart } from '../ui/chart.js';
import { navigate } from '../ui/router.js';
import { viewState } from './page.js';
import { store } from '../lib/store.js';
import { openNew } from '../forms/lazy.js';
import { formatMoney } from '../lib/money.js';
import { periodRange, today, monthBuckets, addMonths, startOfMonth, formatRange, addDays } from '../lib/dates.js';
import { isBalanceSheet, typeInfo } from '../lib/accounts.js';
import { profitAndLoss } from '../lib/reports.js';
import { dueDates } from '../lib/recurring.js';

const LS_PRIVACY = 'bookkeeping:privacy';

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  return name ? `${part}, ${name}` : part;
}

function card(title, body, { action = null, wide = false, className = '' } = {}) {
  return el(`section.card.home-card${wide ? '.wide' : ''}${className ? `.${className}` : ''}`, { 'aria-label': title },
    el('div.card-head', {}, el('h2.card-title', {}, title), action ? el('div.spacer') : null, action),
    el('div.card-body', {}, body));
}

function periodSelect(st, key, onChange) {
  return selectInput({
    options: [['thisMonth', '이번 달'], ['lastMonth', '지난달'], ['thisQuarter', '이번 분기'], ['lastQuarter', '지난 분기'], ['thisYearToDate', '올해 누계'], ['last365', '최근 12개월']],
    value: st[key], ariaLabel: '기간', onChange: (v) => { st[key] = v; onChange(); },
  });
}

export function renderHome(main, _route, { user } = {}) {
  const st = viewState('home', { pnl: 'thisMonth', exp: 'thisMonth' });
  let privacy = false;
  try { privacy = localStorage.getItem(LS_PRIVACY) === 'on'; } catch {}
  const rerender = () => renderHome(main, _route, { user });
  const now = today();
  const fy = store.settings.fiscalStartMonth;
  const sm = store.summary();

  // ------------------------------------------------------ needs attention
  const review = [...store.bankLines.values()].filter((l) => l.status === 'review').length;
  const pendingEstimates = store.txnList((t) => t.type === 'estimate' && (t.status || 'pending') === 'pending').length;
  const reminders = [...store.recurring.values()].filter((r) => r.mode === 'reminder' && dueDates(r, now, 1).length);
  const tasks = [
    sm.overdueCount && { icon: 'alert', tone: 'negative', text: `연체된 청구서 ${sm.overdueCount}건`, amount: sm.overdueInvoices, to: 'invoices?status=overdue' },
    review && { icon: 'bank', tone: 'info', text: `검토할 은행 거래 ${review}건`, to: 'banking' },
    sm.overdueBillCount && { icon: 'receipt', tone: 'warning', text: `연체된 매입채무 ${sm.overdueBillCount}건`, amount: sm.overdueBills, to: 'bills?status=overdue' },
    sm.notDepositedCount && { icon: 'piggy', tone: 'info', text: `입금 대기 중인 수령액 ${sm.notDepositedCount}건`, amount: sm.notDeposited, action: () => openNew('deposit') },
    reminders.length && { icon: 'repeat', tone: 'info', text: `검토할 반복 거래 ${reminders.length}건`, to: 'recurring' },
    pendingEstimates && { icon: 'estimate', tone: 'info', text: `대기 중인 견적서 ${pendingEstimates}건`, to: 'estimates?status=pending' },
  ].filter(Boolean);
  const attention = tasks.length
    ? el('ul.task-list', {}, tasks.map((t) => el('li', {},
      el(t.to ? 'a.task' : 'button.task', { href: t.to ? `#/${t.to}` : null, type: t.to ? null : 'button', onclick: t.action || null },
        el(`span.task-ico.tone-${t.tone}`, { html: icon(t.icon, 16) }),
        el('span.grow', {}, t.text),
        t.amount !== undefined ? el('span.money.priv', {}, formatMoney(t.amount)) : null,
        el('span', { html: icon('chevR', 16) })))))
    : el('div.empty', { style: { padding: '24px 8px' } }, el('div.empty-icon', { html: icon('ok', 24) }), el('h2', {}, '모두 확인했습니다'), el('p', {}, '연체된 청구서, 매입채무, 검토할 은행 거래가 여기에 표시됩니다.'));

  // ------------------------------------------------------------- P&L
  const pr = periodRange(st.pnl, { now, fiscalStartMonth: fy });
  const pnl = profitAndLoss(store, { from: pr.from, to: pr.to, basis: store.settings.accountingMethod });
  const val = (label) => pnl.rows.find((r) => r.label === label)?.values[0] || 0;
  const income = val('수익 합계') + val('기타 수익 합계');
  const expenses = val('비용 합계') + val('매출원가 합계') + val('기타 비용 합계');
  const net = income - expenses;
  const maxBar = Math.max(income, expenses, 1);
  const bar = (label, value, color) => el('div.pl-bar', {},
    el('div.pl-bar-head', {}, el('span.kpi-label', {}, label), el('span.money.priv', {}, formatMoney(value))),
    el('div.progress', { role: 'img', 'aria-label': `${label} ${formatMoney(value)}` }, el('span', { style: { width: `${Math.max(0, (value / maxBar) * 100)}%`, background: `var(${color})` } })));
  const pnlCard = card('손익계산서', el('div.stack', {},
    el('div', {}, el('div.kpi-label', {}, `${formatRange(pr.from, pr.to)} 순이익`), el(`div.kpi-value.priv${net < 0 ? '.neg' : ''}`, {}, formatMoney(net))),
    bar('수익', income, '--chart-1'),
    bar('지출', expenses, '--chart-2'),
    el('a.link-btn', { href: `#/report/pnl` }, '보고서 보기')), { action: periodSelect(st, 'pnl', rerender) });

  // ---------------------------------------------------------- expenses
  const er = periodRange(st.exp, { now, fiscalStartMonth: fy });
  const L = store.ledger(store.settings.accountingMethod);
  const act = L.activity(er.from, er.to);
  const slices = [];
  for (let i = 0; i < L.accountIds.length; i++) {
    const a = store.account(L.accountIds[i]);
    if (!a || !['expense', 'cogs', 'otherExpense'].includes(a.type) || act[i] <= 0) continue;
    slices.push({ label: a.name, value: act[i] });
  }
  slices.sort((a, b) => b.value - a.value);
  const expCard = card('지출', slices.length
    ? donutChart({ title: `${formatRange(er.from, er.to)} 카테고리별 지출`, slices, centerLabel: '총 지출', onSelect: () => navigate('report/pnl') })
    : el('p.muted', {}, '이 기간에 지출이 없습니다.'), { action: periodSelect(st, 'exp', rerender) });

  // ---------------------------------------------------------- invoices
  let paid30 = 0;
  for (const t of store.txns.values()) if (!t.voided && (t.type === 'payment' || t.type === 'salesReceipt') && t.date >= addDays(now, -30)) paid30 += store.total(t);
  const invTotal = Math.max(sm.openInvoices + paid30, 1);
  const invCard = card('청구서', el('div.stack', {},
    el('div.inv-split', {},
      el('div', {}, el('div.kpi-label', {}, `미수령 (${sm.openCount})`), el('div.kpi-value.priv', {}, formatMoney(sm.openInvoices))),
      el('div', {}, el('div.kpi-label', {}, '최근 30일 결제 완료'), el('div.kpi-value.priv', {}, formatMoney(paid30)))),
    el('div.progress.progress-lg', { role: 'img', 'aria-label': `연체 ${formatMoney(sm.overdueInvoices)}, 기한 전 ${formatMoney(sm.openInvoices - sm.overdueInvoices)}, 결제 완료 ${formatMoney(paid30)}` },
      el('span', { style: { width: `${(sm.overdueInvoices / invTotal) * 100}%`, background: 'var(--negative)' } }),
      el('span', { style: { width: `${((sm.openInvoices - sm.overdueInvoices) / invTotal) * 100}%`, background: 'var(--chart-other)' } }),
      el('span', { style: { width: `${(paid30 / invTotal) * 100}%`, background: 'var(--positive)' } })),
    el('ul.legend-list', {},
      el('li', {}, el('span.chart-swatch', { style: { background: 'var(--negative)' } }), el('a', { href: '#/invoices?status=overdue' }, '연체'), el('span.money.priv', {}, formatMoney(sm.overdueInvoices))),
      el('li', {}, el('span.chart-swatch', { style: { background: 'var(--chart-other)' } }), el('a', { href: '#/invoices?status=notDue' }, '기한 전'), el('span.money.priv', {}, formatMoney(sm.openInvoices - sm.overdueInvoices))),
      el('li', {}, el('span.chart-swatch', { style: { background: 'var(--positive)' } }), el('a', { href: '#/invoices?status=paid' }, '결제 완료'), el('span.money.priv', {}, formatMoney(paid30))))));

  // ------------------------------------------------------------ banks
  const banks = store.accountsOfType('bank', 'creditCard');
  const bankCard = card('은행 계좌', banks.length ? el('ul.bank-list', {}, banks.map((a) => {
    const n = [...store.bankLines.values()].filter((l) => l.accountId === a.id && l.status === 'review').length;
    return el('li', {}, el('a.bank-row', { href: `#/banking?account=${a.id}` },
      el('span.task-ico.tone-info', { html: icon(a.type === 'creditCard' ? 'card' : 'bank', 15) }),
      el('span.grow', {}, el('div.truncate', {}, a.name), el('div.cell-sub', {}, n ? `검토 대기 ${n}건` : '모두 최신 상태')),
      el('span', { style: { textAlign: 'right' } },
        el('div.money.priv', {}, formatMoney(store.accountBalance(a.id))),
        el('div.cell-sub', {}, '장부 기준'))));
  })) : el('p.muted', {}, '아직 등록된 은행 계좌가 없습니다.'), { action: el('a.link-btn', { href: '#/banking' }, '은행 거래로 이동') });

  // ------------------------------------------------- income vs expenses
  const months = monthBuckets(startOfMonth(addMonths(now, -11)), now);
  const inc = []; const exp = [];
  for (const m of months) {
    const a = L.activity(m.from, m.to);
    let i = 0; let e = 0;
    for (let k = 0; k < L.accountIds.length; k++) {
      const acct = store.account(L.accountIds[k]);
      if (!acct || isBalanceSheet(acct.type)) continue;
      const v = a[k] * typeInfo(acct.type).sign;
      if (typeInfo(acct.type).cls === 'income') i += v; else e += v;
    }
    inc.push(i); exp.push(e);
  }
  const trendCard = card('수익과 지출', columnChart({
    title: '최근 12개월 월별 수익과 지출',
    categories: months.map((m) => m.label.slice(0, 3)),
    series: [{ name: '수익', values: inc }, { name: '지출', values: exp }],
    onSelect: (i) => navigate(`report/pnl?from=${months[i].from}&to=${months[i].to}`),
  }), { wide: true });

  const privacyBtn = el('button.btn.btn-ghost', { type: 'button', 'aria-pressed': String(privacy) },
    el('span', { html: icon(privacy ? 'eyeOff' : 'eye', 18) }), privacy ? '금액 표시' : '금액 숨기기');
  privacyBtn.addEventListener('click', () => {
    try { localStorage.setItem(LS_PRIVACY, privacy ? 'off' : 'on'); } catch {}
    rerender();
  });

  const quick = [
    ['청구서 만들기', () => openNew('invoice')],
    ['결제 기록', () => openNew('payment')],
    ['지출 기록', () => openNew('expense')],
    ['매입채무 등록', () => openNew('bill')],
    ['매입채무 결제', () => openNew('pay-bills')],
    ['입금 기록', () => openNew('deposit')],
    ['수표 발행', () => openNew('check')],
    ['은행 거래 내역서 업로드', () => import('./banking.js').then((m) => m.openBankImport())],
  ];

  swap(main, el('div.page.home', { class: privacy ? 'privacy-on' : '' },
    el('div.home-hero', {},
      el('h1.page-title.home-title', { tabIndex: -1 }, greeting(user?.username)),
      el('div.spacer'),
      privacyBtn),
    el('div.home-actions', {},
      el('h2.home-actions-title', { id: 'home-actions-title' }, '만들기'),
      el('div.chip-row', { role: 'group', 'aria-labelledby': 'home-actions-title' }, quick.map(([label, fn]) => el('button.chip', { type: 'button', onclick: fn }, el('span', { html: icon('plus', 15) }), label)))),
    el('h2.home-section', {}, '비즈니스 한눈에 보기'),
    el('div.home-grid', {},
      card('주의 필요', attention),
      pnlCard,
      invCard,
      expCard,
      bankCard,
      trendCard)));
}
