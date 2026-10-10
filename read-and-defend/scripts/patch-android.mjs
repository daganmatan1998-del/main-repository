// Makes the generated android/ project ready for a voice game:
//  - RECORD_AUDIO permission (the microphone)
//  - <queries> for the speech service, so Android 11+ lets the app find it
//  - Gradle 8.7 instead of 8.2.1: 8.2.1 cannot run on the Java 21 that current
//    Android Studio ships (Java 17 keeps working with 8.7)
//  Orientation stays free (portrait and landscape both work).
// Safe to run again and again. Plain Node so it behaves the same on Windows,
// macOS and Linux, and writes UTF-8 without a BOM.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!existsSync(manifestPath)) {
  console.error('AndroidManifest.xml not found - run "npx cap add android" first.');
  process.exit(1);
}

let xml = readFileSync(manifestPath, 'utf8').replace(/^﻿/, '');
const before = xml;

if (!xml.includes('android.permission.RECORD_AUDIO')) {
  xml = xml.replace(/(\s*)<uses-permission android:name="android.permission.INTERNET"\s*\/>/,
    (m, ws) => `${m}${ws}<uses-permission android:name="android.permission.RECORD_AUDIO" />`);
  if (!xml.includes('RECORD_AUDIO')) xml = xml.replace('</manifest>', '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n</manifest>');
}
if (!xml.includes('android.speech.RecognitionService')) {
  xml = xml.replace('</manifest>',
    '    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n    </queries>\n</manifest>');
}

if (xml !== before) {
  writeFileSync(manifestPath, xml, { encoding: 'utf8' });
  console.log('AndroidManifest.xml patched (microphone permission + speech service query).');
} else {
  console.log('AndroidManifest.xml already patched.');
}

const wrapperPath = join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
if (existsSync(wrapperPath)) {
  const w = readFileSync(wrapperPath, 'utf8');
  const next = w.replace(/gradle-8\.2\.1-(all|bin)\.zip/, 'gradle-8.7-$1.zip');
  if (next !== w) { writeFileSync(wrapperPath, next, { encoding: 'utf8' }); console.log('Gradle wrapper set to 8.7.'); }
}
