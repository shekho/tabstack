import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SUPPORTED_LOCALES } from '../src/config.js';

const root = new URL('../_locales/', import.meta.url);
const load = (locale) => JSON.parse(readFileSync(new URL(`${locale}/messages.json`, root), 'utf8'));
const en = load('en');
const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (s) => [...new Set(s.match(/\$[1-9]/g) ?? [])].sort();
const boldCount = (s) => (s.match(/\*\*/g) ?? []).length;

test('every bundled locale is listed in SUPPORTED_LOCALES', () => {
    const dirs = readdirSync(root).sort();
    assert.deepEqual([...SUPPORTED_LOCALES].sort(), dirs);
});

for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
    test(`${locale} matches the English messages`, () => {
        const messages = load(locale);
        assert.equal(messages.localeCode?.message, locale);

        for (const [key, { message }] of Object.entries(en)) {
            if (PLURAL.test(key)) continue;
            assert.ok(messages[key]?.message, `${locale} is missing ${key}`);
            assert.deepEqual(placeholders(messages[key].message), placeholders(message), `${locale}.${key} placeholders`);
            assert.equal(boldCount(messages[key].message), boldCount(message), `${locale}.${key} bold markers`);
        }

        // Plural forms vary by language, but every plural message needs _other with the count.
        const bases = new Set(Object.keys(en).filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')));
        for (const base of bases) assert.match(messages[`${base}_other`]?.message ?? '', /\$1/, `${locale}.${base}_other`);

        for (const key of Object.keys(messages)) {
            const base = key.replace(PLURAL, '');
            assert.ok(en[key] || bases.has(base), `${locale} has unknown message ${key}`);
        }
    });
}
