/**
 * Formats a date to the 3PMO brand standard: DD MMM YY
 * e.g. 25 Mar 26
 */
export function formatDate(value: string | number | Date): string {
  const d = new Date(value);
  const day = d.getDate().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear().toString().slice(2);
  return `${day} ${month} ${year}`;
}

/**
 * Formats a datetime to the 3PMO brand standard: DD MMM YY, HH:MM
 * e.g. 25 Mar 26, 10:30
 */
export function formatDateTime(value: string | number | Date): string {
  const d = new Date(value);
  const date = formatDate(d);
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${date}, ${hours}:${minutes}`;
}
