type IconName = 'overview' | 'contacts' | 'leads' | 'opportunities' | 'arrow' | 'search' | 'plus' | 'check' | 'shield' | 'logout' | 'refresh';
const paths: Record<IconName, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  leads: 'M4 20V10 M10 20V4 M16 20v-7 M22 20V8',
  opportunities: 'M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3',
  arrow: 'M5 12h14 M13 6l6 6-6 6', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14', check: 'M5 12l4 4L19 6',
  shield: 'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  logout: 'M9 21H3V3h6 M9 12h12 M17 8l4 4-4 4', refresh: 'M20 7V3l-4 4 M20 7a8 8 0 1 0 1 8',
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
