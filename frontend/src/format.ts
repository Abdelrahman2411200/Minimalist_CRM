export function formatMoney(value: string) {
  const [whole = '0', fraction = '00'] = value.split('.');
  return `EGP ${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}

export function sumMoney(values: string[]) {
  const cents = values.reduce((sum, value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
