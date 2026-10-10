/**
 * Curated Hebrew content, fully vocalised (ניקוד מלא) in standard school
 * pointing. Skills, phonetics, plene spellings and difficulty are all derived
 * from the pointed text by code, so the pointing here is the single source of
 * truth — check it, and everything downstream follows.
 */

export interface HebrewLetterInfo {
  /** Display form, with the dagesh / shin dot that fixes its sound. */
  form: string;
  /** Pointed name, as taught. */
  name: string;
  /** Spellings a recogniser may return for the spoken name. */
  heard: string[];
  /** Keyword starting with the sound, pointed. */
  example: string;
}

/**
 * Letters whose name is recognised from its first two letters alone - the
 * engines often cut these names short ("שי" for שין, "לא" for למד, "מה" for
 * מם, "נו" for נון). They are accepted spellings, so they count even inside
 * a fast run of letters, not only when said on their own.
 */
export const SHORT_NAMES: Record<'ש' | 'ל' | 'מ' | 'נ', string[]> = {
  'ש': ['שי', 'שה', 'שיי', 'שא'],
  'ל': ['לא', 'לה', 'לי', 'למ', 'לם'],
  'מ': ['מה', 'מי', 'מע', 'מא', 'מאי'],
  'נ': ['נו', 'נא', 'נוו', 'נה'],
};

export const LETTERS: HebrewLetterInfo[] = [
  { form: 'א', name: 'אָלֶף', heard: ['אלף', 'אלפ'], example: 'אַבָּא' },
  { form: 'בּ', name: 'בֵּית', heard: ['בית', 'בת', 'בייט'], example: 'בַּיִת' },
  { form: 'ב', name: 'בֵית', heard: ['וית', 'ויט', 'וייט', 'בית'], example: 'חָלָב' },
  { form: 'ג', name: 'גִּימֶל', heard: ['גימל', 'גימעל'], example: 'גַּן' },
  { form: 'ד', name: 'דָּלֶת', heard: ['דלת', 'דאלת'], example: 'דָּג' },
  { form: 'ה', name: 'הֵא', heard: ['הא', 'הי', 'היי', 'הה'], example: 'הַר' },
  { form: 'ו', name: 'וָו', heard: ['וו', 'ואו', 'ווו', 'ואב'], example: 'וֶרֶד' },
  { form: 'ז', name: 'זַיִן', heard: ['זין', 'זיין', 'זאין'], example: 'זָהָב' },
  { form: 'ח', name: 'חֵית', heard: ['חית', 'חת', 'חיט'], example: 'חָלָב' },
  { form: 'ט', name: 'טֵית', heard: ['טית', 'טת', 'טיט', 'תית'], example: 'טַל' },
  { form: 'י', name: 'יוֹד', heard: ['יוד', 'יוט', 'יוּד'], example: 'יָם' },
  { form: 'כּ', name: 'כַּף', heard: ['כף', 'קף', 'כאף'], example: 'כַּד' },
  { form: 'כ', name: 'כָף', heard: ['חף', 'כף', 'חאף'], example: 'אָכַל' },
  { form: 'ל', name: 'לָמֶד', heard: ['למד', 'לאמד', ...SHORT_NAMES['ל']], example: 'לֵב' },
  { form: 'מ', name: 'מֵם', heard: ['מם', 'מים', 'מאם', ...SHORT_NAMES['מ']], example: 'מַיִם' },
  { form: 'נ', name: 'נוּן', heard: ['נון', 'נונ', ...SHORT_NAMES['נ']], example: 'נֵר' },
  { form: 'ס', name: 'סָמֶךְ', heard: ['סמך', 'סמח', 'סאמך'], example: 'סוּס' },
  { form: 'ע', name: 'עַיִן', heard: ['עין', 'עיין', 'איין', 'אין'], example: 'עֵץ' },
  { form: 'פּ', name: 'פֵּא', heard: ['פא', 'פה', 'פי', 'פיי', 'פ'], example: 'פִּיל' },
  { form: 'פ', name: 'פֵא', heard: ['פא', 'פה', 'פי', 'פיי'], example: 'כַּף' },
  { form: 'צ', name: 'צָדִי', heard: ['צדי', 'צאדי', 'צדיק'], example: 'צָב' },
  { form: 'ק', name: 'קוֹף', heard: ['קוף', 'כוף'], example: 'קוֹף' },
  { form: 'ר', name: 'רֵישׁ', heard: ['ריש', 'רש', 'רייש'], example: 'רַךְ' },
  { form: 'שׁ', name: 'שִׁין', heard: ['שין', 'שן', ...SHORT_NAMES['ש']], example: 'שֶׁמֶשׁ' },
  { form: 'שׂ', name: 'שִׂין', heard: ['סין', 'שין', 'שׂין'], example: 'שָׂדֶה' },
  { form: 'ת', name: 'תָּו', heard: ['תו', 'טו', 'תאו', 'תיו'], example: 'תּוּת' },
  { form: 'ך', name: 'כָף סוֹפִית', heard: ['כף סופית', 'חף סופית'], example: 'מֶלֶךְ' },
  { form: 'ם', name: 'מֵם סוֹפִית', heard: ['מם סופית', 'מים סופית', ...SHORT_NAMES['מ']], example: 'יָם' },
  { form: 'ן', name: 'נוּן סוֹפִית', heard: ['נון סופית', ...SHORT_NAMES['נ']], example: 'גַּן' },
  { form: 'ף', name: 'פֵא סוֹפִית', heard: ['פא סופית', 'פה סופית', 'פי סופית'], example: 'כַּף' },
  { form: 'ץ', name: 'צָדִי סוֹפִית', heard: ['צדי סופית', 'צדיק סופית'], example: 'עֵץ' },
];

/** Vowel classes, the marks that write them, and how they are taught. */
export const VOWELS = {
  a: { marks: ['ָ', 'ַ'], label: 'קָמָץ / פַּתָּח', sound: 'a' },
  i: { marks: ['ִ'], label: 'חִירִיק', sound: 'i' },
  o: { marks: ['וֹ', 'ֹ'], label: 'חוֹלָם', sound: 'o' },
  u: { marks: ['וּ', 'ֻ'], label: 'שׁוּרוּק / קֻבּוּץ', sound: 'u' },
  e: { marks: ['ֵ', 'ֶ'], label: 'צֵירֵה / סֶגּוֹל', sound: 'e' },
  shva: { marks: ['ְ'], label: 'שְׁוָא', sound: '' },
} as const;

/**
 * Real words for beginning readers, pointed. Grouped by the vowels they use;
 * the grouping is for people — code derives each word's skills itself.
 */
export const WORDS: string[] = [
  // a (qamats / patah)
  'דָּג', 'יָם', 'שָׁם', 'גַּן', 'חַם', 'קַר', 'טַל', 'גַּל', 'כַּד', 'בַּת', 'דַּף', 'סַל', 'פַּח',
  'מָה', 'שָׁר', 'נָם', 'רָץ', 'קָם', 'בָּא', 'שַׂק', 'חַג', 'זָז', 'גַּג', 'כַּף', 'אַף', 'עַם',
  'פַּר', 'רַךְ', 'הַר', 'צָב', 'אַבָּא', 'סַבָּא', 'מַפָּה', 'סַפָּה', 'שַׁבָּת', 'חַלָּה', 'גָּמָל',
  'חָלָב', 'זָהָב', 'בָּנָנָה', 'עָנָן', 'כָּתַב', 'נָפַל', 'שָׁתָה', 'רָקַד', 'אָכַל', 'הָלַךְ', 'יָשַׁב',
  'קָרָא', 'לָקַח', 'צָחַק', 'סָגַר', 'פָּתַח', 'לָמָה', 'שָׁמַר',
  // i (hiriq)
  'עִם', 'מִי', 'שִׁיר', 'עִיר', 'קִיר', 'סִיר', 'אִישׁ', 'פִּיל', 'תִּיק', 'גִּיר', 'דִּירָה',
  'שִׁירָה', 'אִמָּא', 'חִטָּה', 'כִּתָּה', 'מִטָּה', 'לִי', 'רִיב',
  // o (holam)
  'שָׁלוֹם', 'טוֹב', 'אוֹר', 'קוֹל', 'יוֹם', 'דּוֹד', 'קוֹף', 'עוֹף', 'לֹא', 'גָּדוֹל', 'חָלוֹם',
  'חַלּוֹן', 'אָרוֹן', 'בּוֹר', 'חוֹל', 'דֹּב', 'עוֹד', 'סוֹף', 'רֹאשׁ', 'כּוֹס', 'כָּחֹל', 'יוֹנָה',
  'תּוֹדָה', 'מָתוֹק', 'שׁוֹר',
  // u (shuruq / qubuts)
  'סוּס', 'שׁוּק', 'כַּדּוּר', 'תּוּת', 'חוּם', 'גּוּר', 'קוּם', 'רוּץ', 'סֻכָּה', 'כֻּלָּם', 'בּוּבָּה',
  'צוּר', 'דּוּד',
  // e (tsere / segol)
  'עֵץ', 'בֵּן', 'שֵׁם', 'לֵב', 'נֵר', 'תֵּה', 'פֶּה', 'שֵׂה', 'דֶּלֶת', 'יֶלֶד', 'כֶּלֶב', 'סֵפֶר',
  'מֶלֶךְ', 'גֶּשֶׁם', 'לֶחֶם', 'שֶׁמֶשׁ', 'בַּיִת', 'כֶּסֶף', 'בֹּקֶר', 'עֶרֶב', 'דֶּרֶךְ', 'אֶרֶץ',
  'בֵּיצָה', 'יָפֶה', 'מוֹרֶה', 'אוֹכֵל', 'קוֹרֵא', 'וֶרֶד', 'שָׂדֶה', 'מַיִם',
  // shva and longer words
  'יְלָדִים', 'פְּרָחִים', 'סְפָרִים', 'זְבוּב', 'שֻׁלְחָן', 'חֻלְצָה', 'מִכְתָּב', 'מִסְפָּר',
  'פַּרְפַּר', 'תַּפּוּחַ', 'מִגְדָּל', 'אַרְמוֹן', 'גְּדוֹלָה', 'קְטַנָּה', 'מַחְבֶּרֶת', 'עִפָּרוֹן',
  'שְׂמִיכָה', 'כְּתֹבֶת', 'דְּבוֹרָה', 'נְמָלָה',
];

/** Sentences, pointed. Each must use only words a child could decode. */
export const SENTENCES: string[] = [
  'הַדָּג בַּיָּם.',
  'אַבָּא בַּבַּיִת.',
  'הַכֶּלֶב רָץ.',
  'אִמָּא שָׁרָה.',
  'הַסּוּס גָּדוֹל.',
  'הַיָּם כָּחֹל.',
  'הַגַּן יָפֶה.',
  'יֵשׁ לִי סֵפֶר.',
  'הַיֶּלֶד אָכַל לֶחֶם.',
  'הַדָּג שׂוֹחֶה בַּיָּם.',
  'הַשֶּׁמֶשׁ חַמָּה.',
  'הַקּוֹף אוֹכֵל בָּנָנָה.',
  'אֲנִי קוֹרֵא סֵפֶר.',
  'שָׁלוֹם, סַבָּא!',
  'יֵשׁ דָּג בַּסַּל.',
  'הַפִּיל גָּדוֹל וְהַקּוֹף קָטָן.',
  'הַמֶּלֶךְ יָשַׁב בָּאַרְמוֹן.',
  'הַיְּלָדִים רָצִים בַּגַּן.',
  'יֵשׁ גֶּשֶׁם בַּבֹּקֶר.',
  'הַדְּבוֹרָה עַל הַפֶּרַח.',
];
