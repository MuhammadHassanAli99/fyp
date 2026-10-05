const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function renderTemplate(template: string, variables: Record<string, unknown>, allowed?: string[] | null): string {
  const allow = allowed && allowed.length > 0 ? new Set(allowed) : null;
  return template.replace(PLACEHOLDER, (_full, name: string) => {
    if (allow && !allow.has(name)) return '';
    return stringify(variables[name]);
  });
}

export function renderHtmlEmail(text: string, variables: Record<string, unknown>, allowed?: string[] | null): string {
  const rendered = renderTemplate(text, variables, allowed);
  return `<p style="font:16px/1.5 system-ui,sans-serif">${escapeHtml(rendered).replace(/\n/g, '<br/>')}</p>`;
}

export function languageFallbackChain(preferred: string | null | undefined): string[] {
  const code = (preferred ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
  if (code === 'en') return ['en'];
  return [code, 'en'];
}

export function parseTemplateVariables(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : null;
    } catch {
      return null;
    }
  }
  return null;
}
