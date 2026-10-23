/** Settings: company, preferences, closing the books, appearance, and data. */
import { el, download, pickFile, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field, textInput, textArea, selectInput, dateInput, checkbox, segmented } from '../ui/fields.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/dialog.js';
import { applyTheme, currentTheme } from '../ui/theme.js';
import { pageHead, tabs, viewState, pageDraft, clearDraft } from './page.js';
import { store } from '../lib/store.js';
import { fs } from '../lib/local.js';
import { exportBackup, restoreBackup, validateBackup, eraseAll } from '../lib/backup.js';
import { loadSample, sampleConflicts } from '../lib/sample.js';
import { monthName, today, formatDate } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'INR', 'SGD', 'HKD', 'ZAR', 'MXN', 'BRL'];

function section(title, desc, ...children) {
  return el('section.settings-section', {}, el('div.settings-section-head', {}, el('h2', {}, title), desc ? el('p.field-hint', {}, desc) : null), el('div.settings-section-body', {}, children));
}

export function renderSettings(main, route) {
  const st = viewState('settings', { tab: 'company' });
  const s = store.settings;
  const save = (patch, msg = '저장했습니다') => { try { store.saveSettings(patch); toast(msg); return true; } catch (e) { toastError(e); return false; } };
  const rerender = () => renderSettings(main, route);

  let body;
  if (st.tab === 'company') {
    const c = pageDraft(route, 'company', () => {
      const draft = structuredClone(s.company || {});
      draft.address = draft.address || {};
      return draft;
    });
    const bind = (obj, key, opts = {}) => { const i = textInput({ value: obj[key] || '', type: opts.type || 'text', autocomplete: opts.ac || 'off' }); i.addEventListener('input', () => { obj[key] = i.value; }); return i; };
    body = el('form.stack', { onsubmit: (e) => { e.preventDefault(); if (save({ company: c }, '회사 정보가 저장되었습니다')) clearDraft(route, 'company'); document.dispatchEvent(new CustomEvent('company:changed')); } },
      section('회사명', '청구서, 보고서, 상단 표시줄에 표시됩니다.',
        el('div.form-grid', {}, field('회사명', bind(c, 'name', { ac: 'organization' }), { required: true }), field('법인명', bind(c, 'legalName')), field('사업자번호 또는 납세자번호', bind(c, 'taxId')))),
      section('연락처 정보', null,
        el('div.form-grid', {}, field('회사 이메일', bind(c, 'email', { type: 'email', ac: 'email' })), field('회사 전화', bind(c, 'phone', { type: 'tel', ac: 'tel' })), field('웹사이트', bind(c, 'website', { type: 'url', ac: 'url' })))),
      section('주소', null,
        el('div.form-grid', {}, field('상세 주소', bind(c.address, 'line1', { ac: 'address-line1' }), { className: 'span-2' }), field('도시', bind(c.address, 'city')), field('시/도', bind(c.address, 'state')), field('우편번호', bind(c.address, 'zip')), field('국가', bind(c.address, 'country')))),
      el('div', {}, el('button.btn.btn-primary', { type: 'submit' }, '회사 정보 저장')));
  } else if (st.tab === 'prefs') {
    const terms = selectInput({ options: (s.terms || []).map((t) => [t.id, t.name]), value: s.defaultTerms, ariaLabel: '기본 지급 조건', onChange: (v) => save({ defaultTerms: v }) });
    const currency = selectInput({ options: CURRENCIES.map((c) => [c, c]), value: s.currency, ariaLabel: '기준 통화', onChange: (v) => save({ currency: v }, '통화가 변경되었습니다') });
    const dateStyle = selectInput({ options: [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['ymd', 'YYYY-MM-DD']], value: s.dateStyle, ariaLabel: '날짜 형식', onChange: (v) => save({ dateStyle: v }, '날짜 형식이 변경되었습니다') });
    const fy = selectInput({ options: Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)]), value: String(s.fiscalStartMonth), ariaLabel: '회계연도 시작 월', onChange: (v) => save({ fiscalStartMonth: +v }) });
    const method = segmented({ options: [['accrual', '발생주의'], ['cash', '현금주의']], value: s.accountingMethod, ariaLabel: '보고서의 회계 처리 방식', onChange: (v) => save({ accountingMethod: v }) });
    const start = textInput({ value: String(s.invoiceStart || 1001), inputMode: 'numeric' });
    start.addEventListener('change', () => save({ invoiceStart: Math.max(1, parseInt(start.value, 10) || 1001) }));
    const msg = textArea({ value: s.invoiceMessage || '', rows: 2 });
    msg.addEventListener('change', () => save({ invoiceMessage: msg.value }));
    body = el('div.stack', {},
      section('판매', '새 청구서와 견적서의 기본값입니다.',
        el('div.form-grid', {}, field('기본 지급 조건', terms), field('첫 청구서 번호', start, { hint: '청구서를 만들기 전까지 사용되며, 이후에는 가장 큰 번호부터 이어집니다.' }), field('청구서 기본 메시지', msg, { className: 'span-2' })),
        checkbox({ checked: !!s.paymentsToUndeposited, label: '받은 결제를 미입금 자금에 보관하여 여러 건을 하나의 입금으로 합칩니다', onChange: (v) => save({ paymentsToUndeposited: v }) })),
      section('회계', null,
        el('div.form-grid', {}, field('회계연도 시작 월', fy), field('보고서의 회계 처리 방식', method)),
        checkbox({ checked: s.showAccountNumbers !== false, label: '계정 번호 표시', onChange: (v) => save({ showAccountNumbers: v }) })),
      section('통화 및 형식', '금액은 하나의 기준 통화로 기록됩니다.',
        el('div.form-grid', {}, field('기준 통화', currency), field('날짜 형식', dateStyle))),
      section('지급 조건', '지급 조건은 청구서 또는 매입채무 날짜를 기준으로 만기일을 정합니다.', termsEditor(rerender)));
  } else if (st.tab === 'close') {
    const close = pageDraft(route, 'closeDate', () => ({ value: s.closeDate }));
    const date = dateInput({ value: close.value, ariaLabel: '마감일', onChange: (v) => { close.value = v; } });
    body = el('div.stack', {},
      section('장부 마감', '예를 들어 세금 신고 후나 회계사에게 자료를 보낸 뒤에 특정 날짜 이전의 거래를 변경하지 못하도록 합니다.',
        el('div.form-grid', {}, field('마감일', date)),
        el('div.row', {},
          el('button.btn.btn-primary', { type: 'button', onclick: () => { if (save({ closeDate: date.value || null }, date.value ? `${formatDate(date.value)}까지 장부를 마감했습니다` : '장부를 다시 열었습니다')) clearDraft(route, 'closeDate'); } }, '마감일 저장'),
          s.closeDate ? el('button.btn', { type: 'button', onclick: () => { if (save({ closeDate: null }, '장부를 다시 열었습니다')) clearDraft(route, 'closeDate'); } }, '장부 다시 열기') : null),
        s.closeDate ? el('p.banner.banner-info', {}, el('span', { html: icon('lock', 18) }), `${formatDate(s.closeDate)} 이전 날짜의 거래는 추가, 변경, 삭제할 수 없습니다.`) : null));
  } else if (st.tab === 'look') {
    const theme = segmented({ options: [['system', '시스템'], ['light', '라이트'], ['dark', '다크']], value: currentTheme(), ariaLabel: '테마', onChange: (v) => { applyTheme(v); save({ theme: v }, '테마가 변경되었습니다'); } });
    body = el('div.stack', {}, section('테마', '시스템은 기기 설정을 따릅니다.', theme.root));
  } else {
    const stats = store.stats();
    body = el('div.stack', {},
      section('장부 백업', '회사 전체를 JSON 파일 하나로 저장합니다.',
        el('div.row', { style: { flexWrap: 'wrap' } },
          el('button.btn', { type: 'button', onclick: () => download(JSON.stringify(exportBackup(store), null, 1), `books-backup-${today()}.json`, 'application/json') }, el('span', { html: icon('download', 16) }), '백업 다운로드'),
          el('button.btn', { type: 'button', onclick: async () => {
            try {
              const path = `backups/books-backup-${today()}-${Date.now()}.json`;
              await fs.write(path, JSON.stringify(exportBackup(store)), { createMissingParents: true });
              toast(`${store.settings.company?.name || '내 회사'} 백업을 이 브라우저에 저장했습니다`);
            } catch (e) { toastError(`저장하지 못했습니다: ${e.message || e}`); }
          } }, el('span', { html: icon('cloud', 16) }), '백업 저장(이 브라우저)'),
          el('button.btn', { type: 'button', onclick: restore }, el('span', { html: icon('upload', 16) }), '백업에서 복원'))),
      section('샘플 회사', '예시 디자인 스튜디오 9개월치 데이터로 장부를 채워 모든 화면을 살펴볼 수 있습니다.',
        el('button.btn', { type: 'button', onclick: async () => {
          const clashes = sampleConflicts(store);
          if (clashes.length) {
            toastError(clashes.length > 3 ? '샘플 데이터가 이미 장부에 있습니다.' : `샘플 데이터를 추가하지 못했습니다: ${clashes.join(', ')} 항목이 이미 장부에 있습니다.`);
            return;
          }
          if (store.txns.size && !(await confirmDialog({ title: '샘플 데이터를 추가할까요?', message: '샘플 고객, 공급처, 거래가 기존 기록 옆에 추가됩니다.', confirmLabel: '샘플 데이터 추가' }))) return;
          try {
            loadSample(store);
            toast('샘플 회사를 불러왔습니다');
          } catch (e) { toastError(e); }
        } }, '샘플 데이터 불러오기')),
      section('모두 지우기', '모든 계정, 거래처, 거래, 설정을 삭제합니다. 먼저 백업을 다운로드하세요.',
        el('button.btn.btn-danger', { type: 'button', onclick: async () => {
          const typed = await promptDialog({ title: '모든 데이터를 지울까요?', label: '확인하려면 ERASE를 입력하세요. 이 작업은 되돌릴 수 없습니다.', confirmLabel: '지우기' });
          if (typed !== 'ERASE') { if (typed !== null) toast('아무것도 지워지지 않았습니다.'); return; }
          eraseAll(store);
          store.saveSettings({ onboarded: false });
          toast('모든 데이터가 지워졌습니다');
          location.reload();
        } }, '모든 데이터 지우기')),
      section('이 장부 정보', null,
        el('dl.keyval', {},
          el('dt', {}, '계정과목'), el('dd', {}, String(stats.accounts)),
          el('dt', {}, '거래처'), el('dd', {}, String(stats.contacts)),
          el('dt', {}, '거래'), el('dd', {}, String(stats.txns)),
          el('dt', {}, '원장 기입'), el('dd', {}, String(stats.postings)),
          el('dt', {}, '원장 잔액 검사'), el('dd', {}, stats.imbalance === 0 ? '차변과 대변이 일치합니다' : `${formatMoney(stats.imbalance)}만큼 불일치`),
          el('dt', {}, '저장소'), el('dd', {}, `${store.settings.company?.name || '내 회사'} · 이 브라우저에 저장`))));
  }

  swap(main, el('div.page.settings', {},
    pageHead({ title: '설정', crumbs: [['설정']] }),
    tabs([['company', '회사'], ['prefs', '환경설정'], ['close', '마감일'], ['look', '화면'], ['data', '데이터']], st.tab, (k) => { st.tab = k; rerender(); main.querySelector('.tab[aria-selected="true"]')?.focus(); }, { label: '설정 항목' }),
    body));
}

function termsEditor(rerender) {
  const list = el('ul.terms-list');
  for (const t of store.settings.terms || []) {
    list.append(el('li', {}, el('span.grow', {}, t.name), el('span.muted', {}, `${t.days}일`),
      ['due', 'net15', 'net30', 'net60'].includes(t.id) ? null : el('button.icon-btn', { type: 'button', 'aria-label': `${t.name} 삭제`, html: icon('x', 15), onclick: () => { store.saveSettings({ terms: store.settings.terms.filter((x) => x.id !== t.id) }); rerender(); } })));
  }
  const add = el('button.btn.btn-sm', { type: 'button', onclick: async () => {
    const days = await promptDialog({ title: '새 지급 조건', label: '며칠 후에 만기되나요?', placeholder: '45' });
    const n = parseInt(days, 10);
    if (!Number.isFinite(n) || n < 0) return;
    store.saveSettings({ terms: [...store.settings.terms, { id: `net${n}`, name: n === 0 ? '수령 시 지급' : `정산 ${n}일`, days: n }].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i) });
    rerender();
  } }, '지급 조건 추가');
  return el('div.stack', {}, list, el('div', {}, add));
}

async function restore() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    validateBackup(data);
  } catch (e) {
    toastError(e instanceof SyntaxError ? '이 파일은 올바른 JSON이 아닙니다.' : e.message);
    return;
  }
  const n = Object.values(data.collections || {}).reduce((a, l) => a + l.length, 0);
  const ok = await confirmDialog({ title: '장부를 이 백업으로 교체할까요?', message: `현재 장부의 모든 내용이 ${data.exportedAt?.slice(0, 10) || '알 수 없는 날짜'}의 백업(${n}개 기록)으로 교체됩니다.`, confirmLabel: '복원', danger: true });
  if (!ok) return;
  try {
    restoreBackup(store, data);
    toast('백업을 복원했습니다');
  } catch (e) { toastError(e); }
}
