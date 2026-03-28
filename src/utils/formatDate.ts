const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse a value into a Date, treating date-only ISO strings (YYYY-MM-DD)
 * as LOCAL midnight rather than UTC midnight.
 *
 * Why: `new Date('2026-03-24')` is parsed as UTC 00:00, which in any timezone
 * west of UTC (e.g. EST UTC-5) yields the PREVIOUS calendar day when read
 * with getDate()/getMonth()/getFullYear(). Splitting the string and
 * constructing Date(year, month, day) always uses local time.
 */
function parseDate(value: string | number | Date): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);   // local midnight — no UTC offset issue
  }
  return new Date(value);
}

/**
 * Formats a date to the 3PMO brand standard: DD MMM YY
 * e.g. 25 Mar 26
 */
export function formatDate(value: string | number | Date): string {
  const d = parseDate(value);
  const day = d.getDate().toString().padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear().toString().slice(2);
  return `${day} ${month} ${year}`;
}

/**
 * Formats a datetime to the 3PMO brand standard: DD MMM YY, HH:MM
 * e.g. 25 Mar 26, 10:30
 * Note: full ISO timestamps (with time component) are left as-is for
 * parsing, so the local clock time is preserved correctly.
 */
export function formatDateTime(value: string | number | Date): string {
  const d = parseDate(value);
  const date = formatDate(d);
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${date}, ${hours}:${minutes}`;
}
