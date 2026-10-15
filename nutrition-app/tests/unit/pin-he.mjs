// The unit tests were written against the Hebrew texts; keep them on Hebrew.
// i18n.test.mjs and the English-default checks choose their own language.
if (!process.env.NUTRI_TEST_LANG) globalThis.NUTRI_LANG = 'he';
else if (process.env.NUTRI_TEST_LANG !== 'en') globalThis.NUTRI_LANG = process.env.NUTRI_TEST_LANG;
