// Localization helpers on top of chrome.i18n. Works in extension pages and the
// service worker.
//
// Messages live in _locales/<lang>/messages.json and use $1..$9 for
// substitutions. Plurals use "<key>_<category>" messages (for example
// tabCount_one, tabCount_other) chosen with Intl.PluralRules, since chrome.i18n
// has no plural support. Text wrapped in **double asterisks** is rendered bold
// by applyI18n.
//
// Pseudo-localization for testing: in the side panel's DevTools console run
//   localStorage.setItem('i18n.pseudo', 'on')   // accented, ~40% longer text
//   localStorage.setItem('i18n.pseudo', 'rtl')  // right-to-left layout
// and reload the panel; removeItem('i18n.pseudo') turns it off.

const pseudoMode = (() => {
    try {
        return globalThis.localStorage?.getItem('i18n.pseudo') ?? null;
    } catch {
        return null;
    }
})();

// The browser's language picks the messages file (falling back to "en" when the
// extension has no translation for it). Formatting, plurals, and text direction
// follow the language of the messages actually shown, read from each file's
// localeCode entry, so a browser in an unsupported language gets consistent
// English rather than English text with, say, Hebrew layout.
let resolvedLanguage;
export function uiLanguage() {
    resolvedLanguage ??= (chrome.i18n.getMessage('localeCode') || 'en').replace('_', '-');
    return resolvedLanguage;
}

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

let pluralRules;
let numberFormat;

const ACCENTED = {
    a: '\u00e5', b: '\u0180', c: '\u00e7', d: '\u00f0', e: '\u00e9', f: '\u0192', g: '\u011d', h: '\u0125', i: '\u00ee',
    j: '\u0135', k: '\u0137', l: '\u013c', m: '\u0271', n: '\u00f1', o: '\u00f6', p: '\u00fe', q: '\u01eb', r: '\u0155',
    s: '\u0161', t: '\u0163', u: '\u00fb', v: '\u1e7d', w: '\u0175', x: '\u1e8b', y: '\u00fd', z: '\u017e',
    A: '\u00c5', B: '\u0181', C: '\u00c7', D: '\u00d0', E: '\u00c9', F: '\u0191', G: '\u011c', H: '\u0124', I: '\u00ce',
    J: '\u0134', K: '\u0136', L: '\u013b', M: '\u1e40', N: '\u00d1', O: '\u00d6', P: '\u00de', Q: '\u01ea', R: '\u0154',
    S: '\u0160', T: '\u0162', U: '\u00db', V: '\u1e7c', W: '\u0174', X: '\u1e8a', Y: '\u00dd', Z: '\u017d',
};

export function pseudoLocalize(text) {
    const accented = text.replace(/[A-Za-z]/g, (c) => ACCENTED[c]);
    const padding = '~'.repeat(Math.ceil(text.length * 0.4));
    return `[${accented}${padding}]`;
}

export function t(key, ...subs) {
    const message = chrome.i18n.getMessage(key, subs.map(String));
    if (!message) {
        console.warn(`Missing message: ${key}`);
        return key;
    }
    return pseudoMode === 'on' ? pseudoLocalize(message) : message;
}

export function formatNumber(n) {
    numberFormat ??= new Intl.NumberFormat(uiLanguage());
    return numberFormat.format(n);
}

// tp('tabCount', 3) -> message "tabCount_other" with $1 = "3".
export function tp(key, count) {
    pluralRules ??= new Intl.PluralRules(uiLanguage());
    const category = pluralRules.select(count);
    const exact = chrome.i18n.getMessage(`${key}_${category}`) ? `${key}_${category}` : `${key}_other`;
    return t(exact, formatNumber(count));
}

export function direction() {
    if (pseudoMode === 'rtl') return 'rtl';
    return RTL_LANGUAGES.has(uiLanguage().split('-')[0]) ? 'rtl' : 'ltr';
}

// Replaces el's children with text, rendering **bold** spans as <strong>.
export function setRichText(el, text) {
    const nodes = text.split(/\*\*(.+?)\*\*/).map((part, i) => {
        if (i % 2 === 0) return document.createTextNode(part);
        const strong = document.createElement('strong');
        strong.textContent = part;
        return strong;
    });
    el.replaceChildren(...nodes);
}

/*
    Fills in static text under root:
      data-i18n="key"                      element text (supports **bold**)
      data-i18n-attr="placeholder:key;..." attribute values
*/
export function applyI18n(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) setRichText(el, t(el.dataset.i18n));
    for (const el of root.querySelectorAll('[data-i18n-attr]')) {
        for (const pair of el.dataset.i18nAttr.split(';')) {
            const [attr, key] = pair.split(':').map((s) => s.trim());
            if (attr && key) el.setAttribute(attr, t(key));
        }
    }
}

export function localizeDocument() {
    document.documentElement.lang = uiLanguage();
    document.documentElement.dir = direction();
    applyI18n(document);
    for (const template of document.querySelectorAll('template')) applyI18n(template.content);
}
