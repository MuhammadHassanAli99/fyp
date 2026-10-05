const DEFAULT_MAX = 1000;

const HTML_TAG = /<\/?[^>]+>/g;
const SCRIPTISH = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const EVENT_HANDLER = /\son\w+\s*=\s*(['"]).*?\1/gi;

const PROFANITY = [
  /\bfuck(?:ing|er|ed)?\b/i,
  /\bshit\b/i,
  /\basshole\b/i,
  /\bcunt\b/i,
  /\bnigg(?:er|a)\b/i,
];

export interface BioResult {
  text: string | null;
  flagged: boolean;
}

/**
 * Bios are plain text. Never persist or return unsanitised HTML.
 */
export function sanitizeBio(raw: string | null | undefined, maxLength = DEFAULT_MAX): BioResult {
  if (raw == null) return { text: null, flagged: false };
  let text = String(raw);
  text = text.replace(SCRIPTISH, ' ');
  text = text.replace(EVENT_HANDLER, ' ');
  text = text.replace(HTML_TAG, ' ');
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(HTML_TAG, ' ');
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[^\S\n]+/g, ' ').trim();
  if (!text) return { text: null, flagged: false };

  const flagged = PROFANITY.some((pattern) => pattern.test(text));
  if (text.length > maxLength) text = text.slice(0, maxLength).trim();
  return { text, flagged };
}

export function escapeForDisplay(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
