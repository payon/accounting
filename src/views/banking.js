/**
 * Banking: statement lines to review, categorize, match, or exclude.
 */
import { el, append, clear, pickFile, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { openDialog } from '../ui/dialog.js';
import { selectInput, checkbox, field, textInput } from '../ui/fields.js';
import { navigate, setQuery } from '../ui/router.js';
import { pageHead, splitButton, searchBox, emptyState, viewState, tabs, freshQuery } from './page.js';
import { accountPicker, contactPicker } from '../forms/common.js';
import { openAccountForm } from '../forms/account.js';
import { openTxn } from '../forms/index.js';
import { openRuleForm } from './rules.js';
import { store } from '../lib/store.js';
import { typeLabel } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { formatDate, today } from '../lib/dates.js';
import { findRule, findMatches, draftFromLine, settleFromLine, suggestFromHistory } from '../lib/banking.js';
import { parseCSVStatement, parseOFX, isOFX, dedupe, linesFromCSV } from '../lib/bankimport.js';
import { parseCSV } from '../lib/csv.js';
import { newId } from '../lib/ids.js';

const PAGE = 100;
const drafts = new Map(); // bank line id -> { contactId, categoryId, memo, transferId, mode }

function draftFor(line) {
  if (drafts.has(line.id)) return drafts.get(line.id);
  const rule = findRule([...store.rules.values()], line);
  const hist = rule ? null : suggestFromHistory(store, line);
  const d = {
    mode: rule?.set?.transferAccountId ? 'transfer' : 'categorize',
    contactId: rule?.set?.contactId || hist?.contactId || null,
    categoryId: rule?.set?.categoryId || hist?.categoryId || null,
    transferId: rule?.set?.transferAccountId || null,
    memo: rule?.set?.memo || '',
    ruleName: rule?.name || null,
    fromHistory: !!hist,
  };
  if (!d.categoryId && d.contactId) d.categoryId = store.contact(d.contactId)?.defaultAccountId || null;
  drafts.set(line.id, d);
  return d;
}

export function addLine(line, d = draftFor(line)) {
  const t = d.mode === 'transfer'
    ? draftFromLine(store, line, { transferAccountId: d.transferId, memo: d.memo })
    : draftFromLine(store, line, { contactId: d.contactId, categoryId: d.categoryId, memo: d.memo });
  const saved = store.saveTxn(t);
  store.put('bankLines', { ...line, status: 'added', txnId: saved.id, matched: false });
  drafts.delete(line.id);
  return saved;
}

function matchLine(line, m) {
  if (m.kind === 'open') {
    const saved = store.saveTxn(settleFromLine(store, line, m.txn));
    store.put('bankLines', { ...line, status: 'added', txnId: saved.id, matched: false });
  } else {
    store.put('bankLines', { ...line, status: 'added', txnId: m.txn.id, matched: true });
  }
  drafts.delete(line.id);
}

function undoLine(line) {
  if (line.txnId && !line.matched && store.txn(line.txnId)) store.deleteTxn(line.txnId);
  store.put('bankLines', { ...line, status: 'review', txnId: null, matched: false });
}

export function renderBanking(main, route) {
  const feedAccounts = store.accountsOfType('bank', 'creditCard');
  const st = viewState('banking', { accountId: null, tab: 'review', q: '', shown: PAGE, expanded: null, selected: new Set() });
  const query = freshQuery(route);
  if (query.account) st.accountId = query.account;
  if (!st.accountId || !store.account(st.accountId)) st.accountId = feedAccounts[0]?.id || null;
  const rerender = () => renderBanking(main, { ...route, query: {} });

  const lines = [...store.bankLines.values()];
  const countFor = (accId, status) => lines.filter((l) => l.accountId === accId && l.status === status).length;

  // ----------------------------------------------------------- cards
  const cards = el('div.bank-cards', { role: 'group', 'aria-label': '은행 및 신용카드 계정' },
    feedAccounts.map((a) => {
      const n = countFor(a.id, 'review');
      const on = a.id === st.accountId;
      const b = el('button.bank-card', { type: 'button', 'aria-pressed': String(on), onclick: () => { st.accountId = a.id; st.shown = PAGE; st.selected = new Set(); st.expanded = null; setQuery({ account: null }); rerender(); } },
        el('div.bank-card-head', {}, el('span.bank-card-ico', { html: icon(a.type === 'creditCard' ? 'card' : 'bank', 16) }), el('span.truncate.grow', {}, a.name), n ? el('span.badge.badge-primary', { title: `검토 대기 ${n}건` }, String(n)) : null),
        a.bankBalance ? el('div.bank-card-row', {}, el('span', {}, '은행'), el('strong.money', {}, formatMoney(a.bankBalance.amount))) : null,
        el('div.bank-card-row', {}, el('span', {}, '장부 기준'), el('strong.money', {}, formatMoney(store.accountBalance(a.id)))),
        a.bankBalance ? el('div.bank-card-sub', {}, `${formatDate(a.bankBalance.asOf)} 기준 내역서`) : null);
      return b;
    }),
    el('button.bank-card.bank-card-add', { type: 'button', onclick: async () => { const acc = await openAccountForm({ type: 'bank', types: ['bank', 'creditCard'] }); if (acc) { st.accountId = acc.id; rerender(); } } }, el('span', { html: icon('plus', 18) }), '계정 추가'));

  if (!feedAccounts.length) {
    swap(main, el('div.page', {}, pageHead({ title: '은행 거래', crumbs: [['은행 거래']] }),
      emptyState({ iconName: 'bank', title: '은행 계좌를 추가하세요', text: '당좌·보통·신용카드 계좌를 추가한 뒤, 은행에서 거래 내역서를 업로드하면 여기서 분류할 수 있습니다.', action: el('button.btn.btn-primary', { type: 'button', onclick: () => openAccountForm({ type: 'bank', types: ['bank', 'creditCard'] }) }, '계정 추가') })));
    return;
  }

  const account = store.account(st.accountId);
  const all = lines.filter((l) => l.accountId === st.accountId && l.status === st.tab).sort((a, b) => (st.tab === 'review' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  const q = st.q.trim().toLowerCase();
  const list = q ? all.filter((l) => `${l.desc} ${formatMoney(Math.abs(l.amount))}`.toLowerCase().includes(q)) : all;
  const taken = new Set(lines.filter((l) => l.txnId).map((l) => l.txnId));

  // ----------------------------------------------------------- table
  const table = el('table.grid.feed-table', { 'aria-label': `${account.name}: ${st.tab === 'review' ? '검토 대기' : st.tab}` });
  const allBox = el('input', { type: 'checkbox', 'aria-label': '표시된 항목 모두 선택' });
  allBox.checked = list.length > 0 && list.slice(0, st.shown).every((l) => st.selected.has(l.id));
  allBox.addEventListener('change', () => {
    for (const l of list.slice(0, st.shown)) if (allBox.checked) st.selected.add(l.id); else st.selected.delete(l.id);
    rerender();
  });
  const spentLabel = account.type === 'creditCard' ? '사용 금액' : '지출';
  const recvLabel = account.type === 'creditCard' ? '결제액' : '수령액';
  table.append(el('thead', {}, el('tr', {},
    el('th.check-cell', { scope: 'col' }, allBox),
    el('th', { scope: 'col' }, '날짜'),
    el('th', { scope: 'col' }, '내용'),
    el('th.num', { scope: 'col' }, spentLabel),
    el('th.num', { scope: 'col' }, recvLabel),
    el('th', { scope: 'col', style: { width: '18%' } }, st.tab === 'review' ? '거래처' : '거래처'),
    el('th', { scope: 'col', style: { width: '22%' } }, st.tab === 'review' ? '분류 또는 일치' : st.tab === 'added' ? '추가·일치된 내용' : '사유'),
    el('th', { scope: 'col', style: { width: '1%' } }, el('span.sr-only', {}, '작업')))));
  const tb = el('tbody');
  for (const line of list.slice(0, st.shown)) {
    tb.append(...lineRows(line));
  }
  table.append(tb);

  function lineRows(line) {
    const checked = st.selected.has(line.id);
    const cb = el('input', { type: 'checkbox', checked, 'aria-label': `${line.desc} 선택` });
    cb.addEventListener('change', () => { if (cb.checked) st.selected.add(line.id); else st.selected.delete(line.id); rerender(); });
    const spent = line.amount < 0 ? amountNode(-line.amount) : '';
    const recv = line.amount > 0 ? amountNode(line.amount) : '';
    const tr = el('tr', { class: `${checked ? 'is-selected' : ''} ${st.expanded === line.id ? 'is-expanded' : ''}` });
    const expand = () => { st.expanded = st.expanded === line.id ? null : line.id; rerender(); };
    if (st.tab === 'review') {
      const d = draftFor(line);
      const matches = findMatches(store, line, { takenIds: taken });
      const payee = contactPicker({ kind: 'any', value: d.contactId, ariaLabel: `${line.desc} 거래처`, onChange: (v) => {
        d.contactId = v;
        const def = store.contact(v)?.defaultAccountId;
        if (def && !d.categoryId) { d.categoryId = def; cat.value = def; }
      } });
      const cat = accountPicker({ value: d.categoryId, ariaLabel: `${line.desc} 카테고리`, placeholder: '카테고리 선택', onChange: (v) => { d.categoryId = v; } });
      let middle;
      let action;
      if (matches.length && d.mode !== 'categorize-forced') {
        const m = matches[0];
        middle = el('div.match-cell', {},
          el('span.badge.badge-positive', {}, matches.length > 1 ? `${matches.length}건 일치` : '1건 일치'),
          el('div.cell-sub', {}, `${typeLabel(m.txn.type)}${m.txn.num ? ` #${m.txn.num}` : ''} ${formatDate(m.txn.date)} ${store.contactName(m.txn.contactId)}`),
          el('button.btn-link', { type: 'button', onclick: () => { d.mode = 'categorize-forced'; expand(); } }, '대신 분류하기'));
        action = el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => { try { matchLine(line, m); toast('일치 완료'); } catch (e) { toastError(e); } } }, '일치');
      } else if (d.mode === 'transfer') {
        middle = el('div.cell-sub', {}, `${store.accountName(d.transferId) || '...'} ${line.amount < 0 ? '으로 이체' : '에서 이체'}`);
        action = el('button.btn.btn-sm.btn-primary', { type: 'button', disabled: !d.transferId, onclick: () => { try { addLine(line, d); toast('이체 기록됨'); } catch (e) { toastError(e); } } }, '확인');
      } else {
        middle = el('div', {}, cat.root, d.ruleName ? el('div.cell-sub', {}, el('span', { html: icon('rules', 12) }), ` 규칙: ${d.ruleName}`) : d.fromHistory ? el('div.cell-sub', {}, '과거 내역에서 제안됨') : null);
        action = el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => { try { addLine(line, d); toast('추가됨'); } catch (e) { toastError(e); } } }, '추가');
      }
      tr.append(
        el('td.check-cell', {}, cb),
        el('td.nowrap', {}, formatDate(line.date)),
        el('td', {}, el('button.row-link.feed-desc', { type: 'button', 'aria-expanded': String(st.expanded === line.id), onclick: expand }, line.desc || '(내용 없음)')),
        el('td.num', {}, spent), el('td.num', {}, recv),
        el('td', {}, matches.length && d.mode !== 'categorize-forced' ? el('span.muted', {}, store.contactName(matches[0].txn.contactId)) : payee.root),
        el('td', {}, middle),
        el('td.actions-cell', {}, action));
      const rows = [tr];
      if (st.expanded === line.id) rows.push(detailRow(line, d, matches));
      return rows;
    }
    const t = line.txnId ? store.txn(line.txnId) : null;
    tr.append(
      el('td.check-cell', {}, cb),
      el('td.nowrap', {}, formatDate(line.date)),
      el('td', {}, line.desc),
      el('td.num', {}, spent), el('td.num', {}, recv),
      el('td', {}, t ? store.contactName(t.contactId) : ''),
      el('td', {}, st.tab === 'added' ? (t ? el('button.row-link', { type: 'button', onclick: () => openTxn(t.id) }, `${line.matched ? '일치됨: ' : ''}${typeLabel(t.type)}${t.num ? ` #${t.num}` : ''}`, el('div.cell-sub', {}, store.splitName(t, line.accountId))) : el('span.muted', {}, '거래가 삭제되었습니다')) : el('span.muted', {}, line.excludeReason || '제외됨')),
      el('td.actions-cell', {}, el('button.btn.btn-sm', { type: 'button', onclick: () => {
        if (st.tab === 'added') { undoLine(line); toast('검토 대기로 되돌렸습니다'); } else { store.put('bankLines', { ...line, status: 'review' }); toast('검토 대기로 되돌렸습니다'); }
      } }, st.tab === 'added' ? '되돌리기' : '다시 포함')));
    return [tr];
  }

  function detailRow(line, d, matches) {
    const box = el('div.feed-detail');
    const modeSel = el('div.segmented', { role: 'radiogroup', 'aria-label': '이 거래는 무엇인가요?' });
    const modes = [['categorize', '분류'], ['match', matches.length ? `일치 찾기 (${matches.length})` : '일치 찾기'], ['transfer', '이체로 기록']];
    let mode = d.mode === 'transfer' ? 'transfer' : matches.length && d.mode !== 'categorize-forced' ? 'match' : 'categorize';
    const body = el('div.feed-detail-body');
    const paint = () => {
      modeSel.replaceChildren(...modes.map(([k, l]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(k === mode), onclick: () => { mode = k; paint(); } }, l)));
      clear(body);
      if (mode === 'categorize') {
        const payee = contactPicker({ kind: 'any', value: d.contactId, ariaLabel: '거래처', onChange: (v) => { d.contactId = v; } });
        const cat = accountPicker({ value: d.categoryId, ariaLabel: '카테고리', onChange: (v) => { d.categoryId = v; } });
        const memo = textInput({ value: d.memo || line.desc, ariaLabel: '메모' });
        memo.addEventListener('input', () => { d.memo = memo.value; });
        body.append(el('div.form-grid', {}, field(line.amount < 0 ? '거래처' : '받은 사람', payee), field('카테고리', cat), field('메모', memo, { className: 'span-2' })),
          el('div.row', {},
            el('button.btn.btn-primary', { type: 'button', onclick: () => { d.mode = 'categorize'; try { addLine(line, d); toast('추가됨'); } catch (e) { toastError(e); } } }, '추가'),
            el('button.btn', { type: 'button', onclick: () => openRuleForm({ fromLine: line, draft: d }) }, '규칙 만들기'),
            el('button.btn.btn-ghost', { type: 'button', onclick: () => exclude([line]) }, '제외')));
      } else if (mode === 'match') {
        if (!matches.length) body.append(el('p.muted', {}, '장부에서 이 금액과 10일 이내에 일치하는 거래가 없습니다. 대신 분류하거나 이체로 기록하세요.'));
        else {
          body.append(el('ul.match-list', {}, matches.map((m) => el('li', {},
            el('div.grow', {}, el('strong', {}, `${m.kind === 'open' ? '미결제 ' : ''}${typeLabel(m.txn.type)}${m.txn.num ? ` #${m.txn.num}` : ''}`), ` ${formatDate(m.txn.date)} · ${store.contactName(m.txn.contactId) || ''} · ${formatMoney(m.kind === 'open' ? store.openBalance(m.txn.id) : Math.abs(line.amount))}`,
              m.kind === 'open' ? el('div.cell-sub', {}, line.amount > 0 ? '이 청구서에 대한 결제를 기록합니다' : '이 매입채무의 결제를 기록합니다') : null),
            el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => { try { matchLine(line, m); toast('일치 완료'); } catch (e) { toastError(e); } } }, '일치')))));
        }
      } else {
        const other = accountPicker({ value: d.transferId, types: ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity'], exclude: [line.accountId], ariaLabel: line.amount < 0 ? '이체 대상' : '이체 출처', onChange: (v) => { d.transferId = v; } });
        body.append(el('div.form-grid', {}, field(line.amount < 0 ? '이체 대상' : '이체 출처', other)),
          el('div.row', {}, el('button.btn.btn-primary', { type: 'button', onclick: () => {
            if (!d.transferId) { toastError('상대 계정을 선택하세요.'); return; }
            d.mode = 'transfer';
            try { addLine(line, d); toast('이체 기록됨'); } catch (e) { toastError(e); }
          } }, '이체 기록')));
      }
    };
    paint();
    box.append(modeSel, body);
    return el('tr.feed-detail-row', {}, el('td', { colSpan: 8 }, box));
  }

  const selectedLines = list.filter((l) => st.selected.has(l.id));
  async function exclude(ls) {
    for (const l of ls) store.put('bankLines', { ...l, status: 'excluded' }, { silent: false });
    st.selected = new Set();
    toast(`${ls.length}건 제외됨`);
  }
  const batch = st.selected.size ? el('div.selection-bar', {},
    el('span', {}, `${selectedLines.length}개 선택됨`),
    st.tab === 'review' ? [
      el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => {
        let n = 0; let skipped = 0;
        for (const l of selectedLines) {
          const d = draftFor(l);
          if (d.mode === 'transfer' && !d.transferId) { skipped++; continue; }
          try { addLine(l, d); n++; } catch { skipped++; }
        }
        st.selected = new Set();
        toast(`${n}건 추가됨${skipped ? `, ${skipped}건 건너뜀` : ''}`);
      } }, '승인'),
      el('button.btn.btn-sm', { type: 'button', onclick: () => exclude(selectedLines) }, '제외'),
    ] : el('button.btn.btn-sm', { type: 'button', onclick: () => {
      for (const l of selectedLines) { if (st.tab === 'added') undoLine(l); else store.put('bankLines', { ...l, status: 'review' }); }
      st.selected = new Set();
      toast('검토 대기로 되돌렸습니다');
    } }, st.tab === 'added' ? '되돌리기' : '다시 포함'),
    el('button.btn-link', { type: 'button', onclick: () => { st.selected = new Set(); rerender(); } }, '선택 해제')) : null;

  const content = list.length
    ? el('div.table-wrap', {}, el('div.table-scroll', {}, table),
      list.length > st.shown ? el('div.table-foot', {}, el('button.btn.btn-sm', { type: 'button', onclick: () => { st.shown += PAGE * 2; rerender(); } }, `더 보기 (남은 ${list.length - st.shown}건)`)) : null)
    : el('div.table-wrap', {}, emptyState({
      iconName: st.tab === 'review' ? 'ok' : 'inbox',
      title: st.tab === 'review' ? (q ? '일치하는 항목이 없습니다' : '모두 확인했습니다') : '내용이 없습니다',
      text: st.tab === 'review' ? '은행에서 거래 내역서(CSV 또는 OFX)를 업로드하면 거래를 여기서 검토할 수 있습니다.' : st.tab === 'added' ? '추가하거나 일치시킨 거래가 여기에 표시됩니다.' : '제외한 거래가 여기에 표시됩니다.',
      action: st.tab === 'review' ? el('button.btn.btn-primary', { type: 'button', onclick: () => openBankImport(st.accountId) }, '거래 업로드') : null,
    }));

  swap(main, el('div.page', {},
    pageHead({
      title: '은행 거래',
      crumbs: [['은행 거래']],
      actions: [
        el('a.btn', { href: '#/rules' }, '규칙'),
        splitButton('거래 업로드', () => openBankImport(st.accountId), [
          { label: '원장으로 이동', icon: 'journal', onClick: () => navigate(`register/${st.accountId}`) },
          { label: '이 계정 대조', icon: 'scale', onClick: () => navigate(`reconcile/${st.accountId}`) },
        ]),
      ],
    }),
    cards,
    tabs([['review', '검토 대기', countFor(st.accountId, 'review')], ['added', '추가됨', countFor(st.accountId, 'added')], ['excluded', '제외됨', countFor(st.accountId, 'excluded')]], st.tab, (k) => { st.tab = k; st.selected = new Set(); st.shown = PAGE; st.expanded = null; rerender(); main.querySelector('.tab[aria-selected="true"]')?.focus(); }, { label: '은행 거래 상태' }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: '내용 또는 금액으로 검색', label: '은행 거래 검색', onInput: (v) => { st.q = v; rerender(); main.querySelector('input[type="search"]')?.focus(); } }),
      el('div.toolbar-end', {}, el('span.muted', {}, `거래 ${list.length}건`))),
    batch,
    content));
}

// ------------------------------------------------------------------ import

export async function openBankImport(accountId) {
  const file = await pickFile('.csv,.ofx,.qfx,.qbo,text/csv');
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toastError('파일 크기가 10 MB를 넘습니다.'); return; }
  const text = await file.text();
  let acct = accountId || store.accountsOfType('bank', 'creditCard')[0]?.id;
  let parsed;
  let mapping = null;
  let invert = false;
  let dateStyle = store.settings.dateStyle === 'dmy' ? 'dmy' : 'mdy';
  const ofx = isOFX(text);
  if (ofx) parsed = parseOFX(text);
  else {
    parsed = parseCSVStatement(text, { dateStyle });
    mapping = parsed.mapping;
  }
  const rows = ofx ? null : parseCSV(text);
  // A file with several accounts' statements is imported one statement at a time.
  let stmt = 0;
  const statement = () => parsed.statements[stmt];
  const acctPick = accountPicker({ value: acct, types: ['bank', 'creditCard'], ariaLabel: 'Account', onChange: (v) => { acct = v; preview(); } });
  const mapBox = el('div');
  const previewBox = el('div');

  function currentLines() {
    if (ofx) return { lines: statement().lines, skipped: [] };
    return linesFromCSV(rows, mapping, { hasHeader: parsed.hasHeader, dateStyle, invert });
  }

  function paintMapping() {
    if (ofx) return;
    const headers = parsed.headers;
    const sel = (key, label) => {
      const s = el('select.select', { 'aria-label': label }, el('option', { value: '-1' }, '없음'), headers.map((h, i) => el('option', { value: String(i), selected: mapping[key] === i }, h)));
      s.addEventListener('change', () => { mapping[key] = +s.value; preview(); });
      return field(label, s);
    };
    const modeSel = selectInput({ options: [['single', '한 개 열 (음수가 지출)'], ['split', '두 개 열 (지출과 수입)']], value: mapping.mode, ariaLabel: '금액 열', onChange: (v) => { mapping.mode = v; paintMapping(); preview(); } });
    const styleSel = selectInput({ options: [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY']], value: dateStyle, ariaLabel: '날짜 형식', onChange: (v) => { dateStyle = v; preview(); } });
    append(clear(mapBox), [el('div.form-grid', {},
      sel('date', '날짜 열'), sel('desc', '내용 열'), field('날짜 형식', styleSel), field('금액', modeSel),
      mapping.mode === 'split' ? [sel('debit', '지출 열'), sel('credit', '수입 열')] : sel('amount', '금액 열')),
    mapping.mode === 'single' ? checkbox({ checked: invert, label: '은행에서 지출을 양수로 표시합니다', onChange: (v) => { invert = v; preview(); } }) : null]);
  }

  function preview() {
    const { lines, skipped } = currentLines();
    const existing = [...store.bankLines.values()].filter((l) => l.accountId === acct);
    const { fresh, duplicates } = dedupe(lines, existing);
    append(clear(previewBox), [
      el('p', { role: 'status' }, `새 거래 ${fresh.length}건${duplicates ? `, 이미 가져온 ${duplicates}건 건너뜀` : ''}${skipped.length ? `, 읽을 수 없는 행 ${skipped.length}개` : ''}.`),
      fresh.length ? el('div.table-wrap', {}, el('table.grid', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '날짜'), el('th', { scope: 'col' }, '내용'), el('th.num', { scope: 'col' }, '금액'))),
        el('tbody', {}, fresh.slice(0, 6).map((l) => el('tr', {}, el('td', {}, formatDate(l.date)), el('td', {}, l.desc), el('td.num', {}, amountNode(l.amount))))))) : null]);
    importBtn.disabled = !fresh.length || !acct;
  }

  const importBtn = el('button.btn.btn-primary', { type: 'button' }, '가져오기');
  importBtn.addEventListener('click', () => {
    const { lines } = currentLines();
    const existing = [...store.bankLines.values()].filter((l) => l.accountId === acct);
    const { fresh } = dedupe(lines, existing);
    const importId = newId();
    const rules = [...store.rules.values()];
    let auto = 0;
    store.batch(({ put }) => {
      for (const l of fresh) put('bankLines', { ...l, accountId: acct, status: 'review', importId, importedAt: Date.now() });
      if (ofx && statement().balance !== null) put('accounts', { ...store.account(acct), bankBalance: { amount: statement().balance, asOf: fresh.reduce((m, l) => (l.date > m ? l.date : m), today()) } });
    });
    // Rules marked "add automatically" categorize straight into the books.
    for (const line of [...store.bankLines.values()].filter((l) => l.importId === importId)) {
      const rule = findRule(rules, line);
      if (rule?.autoAdd && (rule.set?.categoryId || rule.set?.transferAccountId)) {
        try { addLine(line, { mode: rule.set.transferAccountId ? 'transfer' : 'categorize', contactId: rule.set.contactId || null, categoryId: rule.set.categoryId || null, transferId: rule.set.transferAccountId || null, memo: rule.set.memo || '' }); auto++; } catch {}
      }
    }
    toast(`거래 ${fresh.length}건을 가져왔습니다${auto ? `, 규칙으로 ${auto}건 추가됨` : ''}`);
    dlg.close();
    navigate(`banking?account=${acct}`);
  });
  paintMapping();
  const dlg = openDialog({
    title: '은행 거래 업로드',
    wide: true,
    body: el('div.stack', {},
      el('p.field-hint', {}, `${file.name} (${ofx ? 'OFX 내역서' : 'CSV'})`),
      ofx && parsed.statements.length > 1 ? field('이 파일에는 여러 계좌의 내역서가 들어 있습니다. 이번에 가져올 계좌는 어느 것인가요?', selectInput({
        options: parsed.statements.map((st, i) => [String(i), `${{ CHECKING: '당좌예금', SAVINGS: '보통예금', CREDITCARD: '신용카드', MONEYMRKT: '금전신탁', CREDITLINE: '한도 대출' }[st.accountType] || '계정'}${st.accountNumber ? ` (끝자리 ${st.accountNumber.slice(-4)})` : ''} (거래 ${st.lines.length}건)`]),
        value: '0',
        onChange: (v) => { stmt = +v; preview(); },
      }), { hint: '나머지 계좌는 파일을 다시 업로드해서 각각의 계정으로 가져오세요.' }) : null,
      field('이 내역은 어느 계정에서 온 것인가요?', acctPick, { required: true }),
      mapBox,
      previewBox),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), importBtn),
  });
  preview();
}

