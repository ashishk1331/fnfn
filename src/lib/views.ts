export type View = 'live' | 'events' | 'search' | 'system';

export function viewFromHash(hash: string): View {
  const value = hash.replace(/^#/, '');
  return value === 'events' || value === 'search' || value === 'system'
    ? value
    : 'live';
}
