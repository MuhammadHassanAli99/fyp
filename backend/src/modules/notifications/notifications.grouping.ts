export function groupedTitle(count: number, singular: string, plural: string): string {
  if (count <= 1) return singular;
  return plural.replace('{{count}}', String(count));
}

export function groupedFavoriteCopy(count: number): { title: string; body: string } {
  if (count <= 1) {
    return { title: 'Someone saved your listing', body: 'A buyer saved your listing.' };
  }
  return {
    title: `${count} people saved your listing`,
    body: `${count} people saved your listing.`,
  };
}
