const CATEGORY_DISPLAY_NAME_MAP: Record<string, string> = {
  'Women Beauty': 'Ladies Beauty',
  Men: 'Gentlemen Beauty',
};

export function getCategoryDisplayName(name?: string | null): string {
  if (!name) {
    return '';
  }

  return CATEGORY_DISPLAY_NAME_MAP[name] || name;
}
