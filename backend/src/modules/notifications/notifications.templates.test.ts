import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, languageFallbackChain, renderHtmlEmail, renderTemplate } from './notifications.templates';

describe('template engine', () => {
  it('substitutes declared variables and drops unknown placeholders when allow-listed', () => {
    const out = renderTemplate(
      '{{vehicleName}} price has changed to {{price}}.',
      { vehicleName: 'Corolla', price: '12,000 AED', secret: 'nope' },
      ['vehicleName', 'price'],
    );
    assert.equal(out, 'Corolla price has changed to 12,000 AED.');
  });

  it('falls back through preferred language then English', () => {
    assert.deepEqual(languageFallbackChain('ur-PK'), ['ur', 'en']);
    assert.deepEqual(languageFallbackChain('en'), ['en']);
  });

  it('HTML-escapes email variables', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    const html = renderHtmlEmail('Hello {{name}}', { name: '<b>x</b>' }, ['name']);
    assert.equal(html.includes('<b>'), false);
    assert.equal(html.includes('&lt;b&gt;x&lt;/b&gt;'), true);
  });
});
