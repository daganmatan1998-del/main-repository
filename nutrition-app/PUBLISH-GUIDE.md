# פרסום נוטרי: שתי אפליקציות (בתשלום לקהל + בחינם לחברים)

הקוד אחד, אבל יוצאות ממנו **שתי אפליקציות נפרדות לגמרי**:

| | `public` (קהל, בתשלום) | `friends` (חברים, חינם) |
|---|---|---|
| שם בטלפון | נוטרי | נוטרי חברים |
| מזהה אפליקציה | `app.nutri.planner` | `app.nutri.planner.friends` |
| שרת (Cloudflare Worker) | `nutri-public` | `nutri-friends` |
| איך מפיצים | Google Play / App Store, **בתשלום** | קישור PWA, או APK / TestFlight |

שרת נפרד לכל אחת = המכסות והעלויות של החברים לא נוגעות בלקוחות המשלמים, ואפשר לכבות אחד בלי לפגוע בשני.
`flavors/*.json` הם מקום השינוי היחיד לשם, למזהה ולכתובת השרת.

## 1. בניית שני הפרויקטים
```bash
npm run flavors          # יוצר build/public ו-build/friends
```

## 2. העלאת השרת (לכל אחד, פעם אחת)
```bash
cd build/public
npm install
npx wrangler login
npx wrangler secret put GOOGLE_API_KEY      # ושאר המפתחות מ-.env.example
npm run deploy                              # → https://nutri-public.<שם-שלך>.workers.dev
```
אותו דבר מתוך `build/friends`. בשלב הזה כבר יש **גרסת PWA עובדת בקישור** (פותחים בכרום/ספארי ← "הוסף למסך הבית"). לחברים זה הדרך הכי קלה: בלי חנות ובלי עלות.

## 3. כתובת השרת בתוך האפליקציה
הדביקו את כתובת ה-workers.dev ב-`apiBase` של `flavors/public.json` (וכך גם ב-friends), ואז:
```bash
cd .. && npm run flavors
```

## 4. אפליקציית מובייל (Capacitor)
```bash
cd build/public
npm install
npx cap add android && npx cap add ios      # iOS דורש Mac עם Xcode
npx cap sync
npx cap open android                        # Android Studio ← Build ← Generate Signed Bundle (.aab)
```
אייקון ומסך פתיחה: שימו `icon.png` (1024×1024) ב-`resources/` ואז `npx @capacitor/assets generate`.
לפני כל העלאה חדשה: `npm run flavors` ← `npx cap sync` מתוך התיקייה.

## 5. תשלום (קהל)
- **הכי פשוט, בלי קוד:** באפליקציה בתשלום קובעים מחיר ב-Play Console / App Store Connect. החנות גובה, מנהלת החזרים ונותנת אפליקציה רק למי ששילם. החנות לוקחת 15–30%.
- מנוי חודשי או רכישה בתוך האפליקציה דורשים קוד חיוב (RevenueCat מתאים) – לא נכלל כרגע.
- בחנויות נדרשים: חשבון מפתח (Google ‏$25 חד-פעמי, Apple ‏$99 לשנה), מדיניות פרטיות (האפליקציה שולחת תמונות לניתוח, חובה לציין), והצהרת בטיחות נתונים.
- אפליקציית תזונה/בריאות: מומלץ להשאיר את ההבהרה "לא ייעוץ רפואי" שכבר קיימת בצ'אט.

## 6. הפצה לחברים
1. **PWA** (מומלץ): שולחים את קישור ה-workers.dev של `friends`.
2. **Android APK**: Android Studio ← Build APK, שולחים את הקובץ.
3. **iPhone**: TestFlight (דורש חשבון Apple Developer).
