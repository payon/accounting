/**
 * Recurring transactions: a template plus a schedule.
 *
 *   { name, type, template, interval: 'day'|'week'|'month'|'year', every,
 *     startDate, endDate?, maxCount?, count, nextDate, mode: 'scheduled'|'reminder',
 *     daysBefore, active }
 *
 * 'scheduled' creates the transaction on its date. 'reminder' lists it on
 * the home page for someone to review and save.
 */
import { addDays, addMonths } from './dates.js';

export const INTERVALS = [
  ['day', '매일'],
  ['week', '매주'],
  ['month', '매월'],
  ['year', '매년'],
];

export function advance(date, interval, every = 1, anchorDay) {
  const n = Math.max(1, Math.floor(every || 1));
  switch (interval) {
    case 'day': return addDays(date, n);
    case 'week': return addDays(date, 7 * n);
    case 'year': return addMonths(date, 12 * n, anchorDay);
    default: return addMonths(date, n, anchorDay);
  }
}

/** Whether a schedule has ended (by date or count). */
export function isFinished(r) {
  if (r.active === false) return true;
  if (r.maxCount && (r.count || 0) >= r.maxCount) return true;
  if (r.endDate && r.nextDate && r.nextDate > r.endDate) return true;
  return false;
}

/**
 * Dates due on or before `today` (plus `daysBefore` for scheduled templates
 * that create early), capped so a schedule left paused for years does not
 * flood the books.
 */
export function dueDates(r, today, cap = 24) {
  const out = [];
  if (isFinished(r) || !r.nextDate) return out;
  const horizon = addDays(today, r.mode === 'scheduled' ? r.daysBefore || 0 : 0);
  const anchor = +(r.startDate || r.nextDate).slice(8, 10);
  let d = r.nextDate;
  let count = r.count || 0;
  while (d <= horizon && out.length < cap) {
    if (r.endDate && d > r.endDate) break;
    if (r.maxCount && count >= r.maxCount) break;
    out.push(d);
    count++;
    d = advance(d, r.interval, r.every, r.interval === 'month' || r.interval === 'year' ? anchor : undefined);
  }
  return out;
}

/** The schedule after `n` occurrences were created. */
export function afterCreating(r, n) {
  if (!n) return r;
  const anchor = +(r.startDate || r.nextDate).slice(8, 10);
  let d = r.nextDate;
  for (let i = 0; i < n; i++) d = advance(d, r.interval, r.every, r.interval === 'month' || r.interval === 'year' ? anchor : undefined);
  return { ...r, nextDate: d, count: (r.count || 0) + n, lastCreated: r.nextDate };
}

export function describeSchedule(r) {
  const every = Math.max(1, r.every || 1);
  const unit = { day: '일', week: '주', month: '개월', year: '년' }[r.interval] || '개월';
  const base = every === 1 ? { day: '매일', week: '매주', month: '매월', year: '매년' }[unit] || '매월' : `매 ${every}${unit}마다`;
  const end = r.endDate ? `, ${r.endDate}까지` : r.maxCount ? `, ${r.maxCount}회` : '';
  return base + end;
}
