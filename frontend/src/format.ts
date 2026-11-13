export function formatMoney(value: string) {
  const [whole = '0', fraction = '00'] = value.split('.');
  return `EGP ${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}

export function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
