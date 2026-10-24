export type View = 'live' | 'events' | 'system';

export function viewFromHash(hash: string): View {
  const value = hash.replace(/^#/, '');
  return value === 'events' || value === 'system' ? value : 'live';
}
