/** Sign-in screen, error screen, and the first-run company setup. */
import { el, append } from '../ui/dom.js';
import { icon, appMark } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, selectInput, checkbox } from '../ui/fields.js';
import { monthName } from '../lib/dates.js';

export function authView({ onSignIn, error = null }) {
  const btn = el('button.btn.btn-primary.auth-cta', { type: 'button' }, '열기');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '여는 중';
    try {
      await onSignIn();
    } finally {
      btn.disabled = false;
      btn.textContent = '열기';
    }
  });
  return el('main.auth', { id: 'main' },
    el('div.auth-card', {},
      el('div.auth-mark', { html: appMark(56) }),
      el('h1.auth-title', {}, 'Payon'),
      el('p.auth-sub', {}, '청구서, 매입채무, 은행 거래, 계좌 대조, 재무보고서를 이 브라우저의 Payon 저장소에 저장합니다.'),
      error ? el('p.field-error', { role: 'alert' }, error) : null,
      btn,
      el('ul.auth-points', {},
        ['항상 균형이 맞는 복식부기 장부', '손익계산서, 재무상태표, 현금흐름, 계좌 연령 분석', '내 데이터는 내 계정에 보관됩니다'].map((t) => el('li', {}, el('span', { html: icon('check', 16) }), t)))));
}

export function errorView({ title, message, onRetry }) {
  return el('main.auth', { id: 'main' },
    el('div.auth-card', {},
      el('div.empty-icon', { html: icon('offline', 26) }),
      el('h1.auth-title', { style: { fontSize: '22px' } }, title),
      el('p.auth-sub', {}, message),
      el('button.btn.btn-primary.auth-cta', { type: 'button', onclick: onRetry }, '다시 시도')));
}

export function bootView(text = '장부를 여는 중') {
  return el('div.boot', { role: 'status', 'aria-live': 'polite' }, el('div.boot-inner', {}, el('div', { html: appMark(48) }), el('div.boot-bar'), el('span', {}, text)));
}

/** First run: name the company and pick basics. Resolves { name, currency, fiscalStartMonth, dateStyle, sample }. */
export function onboarding({ defaultName = '' } = {}) {
  return new Promise((resolve) => {
    const o = { name: defaultName, currency: 'KRW', fiscalStartMonth: 1, dateStyle: 'ymd', sample: false };
    const name = textInput({ value: o.name, autocomplete: 'organization' });
    const nameErr = el('span.field-error', { role: 'alert', hidden: true }, '회사 이름을 입력하세요.');
    name.addEventListener('input', () => { o.name = name.value; nameErr.hidden = true; name.removeAttribute('aria-invalid'); });
    const currency = selectInput({ options: ['KRW', 'USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF', 'INR', 'SGD', 'ZAR', 'MXN', 'BRL'].map((c) => [c, c]), value: o.currency, onChange: (v) => { o.currency = v; } });
    const fy = selectInput({ options: Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)]), value: '1', onChange: (v) => { o.fiscalStartMonth = +v; } });
    const ds = selectInput({ options: [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['ymd', 'YYYY-MM-DD']], value: o.dateStyle, onChange: (v) => { o.dateStyle = v; } });
    const sample = checkbox({ checked: false, label: '샘플 회사 데이터로 미리 살펴보기', onChange: (v) => { o.sample = v; } });
    let done = false;
    const finish = () => {
      o.name = o.name.trim();
      if (!o.name) {
        nameErr.hidden = false;
        name.setAttribute('aria-invalid', 'true');
        name.focus();
        return;
      }
      done = true;
      dlg.close();
      resolve(o);
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
    const dlg = openDialog({
      title: '장부 설정',
      body: el('div.stack', {},
        el('p', {}, '표준 계정과목이 자동으로 만들어집니다. 이 내용은 나중에 설정에서 언제든 바꿀 수 있습니다.'),
        append(field('회사명', name, { required: true }), [nameErr]),
        el('div.form-grid', {}, field('기준 통화', currency), field('회계연도 시작 월', fy), field('날짜 형식', ds)),
        sample),
      footer: el('div.end', {}, el('button.btn.btn-primary', { type: 'button', onclick: finish }, '장부 만들기')),
      initialFocus: name,
      onClose: () => { if (!done) resolve({ ...o, name: o.name.trim() || '내 회사' }); },
    });
  });
}
