# נוטרי (Nutri): personal nutrition-planning PWA

A Hebrew, right-to-left, mobile-first nutrition planner you install as an app. It works out your calories and macros for a cut, maintenance or bulk period. It builds a daily menu that respects your restrictions, swaps any item for an equivalent, and has a Claude-powered nutrition assistant. A weekly progress photo is required: a blocking check-in that unlocks only after you upload a photo and then update your weight and body fat.

```
nutrition-app/
├── www/                     ← the whole app (static files, no build step)
│   ├── index.html  manifest.webmanifest  sw.js  _headers
│   ├── css/app.css
│   ├── js/
│   │   ├── app.js           shell, router, weekly-gate enforcement
│   │   ├── nutrition.js     BMR/TDEE, safe pacing, calories & macros (pure)
│   │   ├── mealplan.js      daily menu generator + portion solver (pure)
│   │   ├── substitutions.js equivalent swaps (pure)
│   │   ├── foods.js         food database (143 foods), diet/allergy/kosher rules
│   │   ├── schedule.js      week math from the registration date (pure)
│   │   ├── store.js  db.js  state + IndexedDB, clock-rollback guard
│   │   ├── image.js         client-side photo compression
│   │   ├── chat.js          assistant client (calls /api/chat only)
│   │   ├── notify.js  install.js  theme.js  chart.js  components.js  util.js
│   │   └── screens/         onboarding, checkin (gate), today, plan, assistant, gallery, profile, period
│   ├── icons/  fonts/       (Rubik, OFL; bundled so it works offline)
├── server/
│   ├── api.js               /api/chat → Claude (the only place the API key exists)
│   ├── system-prompt.js     the assistant's system prompt
│   ├── worker.js            Cloudflare Worker entry (serves www/ + /api)
│   └── dev-server.mjs       local server, same handler
├── tests/unit/              engine + proxy tests (node --test)
├── tests/e2e/run.mjs        every user flow in headless Chromium
├── wrangler.toml  capacitor.config.json  package.json
```

## Windows: one-click upload

Install Node.js (LTS, from nodejs.org), then double-click **`UPLOAD-APP.bat`** in this folder. It installs, opens the Cloudflare sign-in, uploads the app, asks for the Claude key in a dialog (optional), and gives you the link, copied to the clipboard and saved in `APP-LINK.txt`. Run it again any time to publish changes. Everything happens in Hebrew dialog windows; nothing has to be typed in a terminal.

## Run it locally

```bash
cd nutrition-app
npm install
cp .env.example .env          # put your AI keys in .env (every one is optional; see "AI engines" below)
npm run dev                   # → http://localhost:8787
```

Open it on a phone on the same network, or use Chrome DevTools' device mode. Everything except the assistant works without a key. Without one, the assistant replies that it isn't configured, and the on-device swap buttons still work.

## The Claude API key

1. Create a key at <https://console.anthropic.com> → **API Keys**.
2. **Local:** put it in `nutrition-app/.env` as `ANTHROPIC_API_KEY=sk-ant-...`. `.env` is git-ignored.
3. **Production:** store it as a Worker secret. It never appears in any file:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

The browser never sees a key. The app calls `/api/...` on its own origin, and `server/api.js` adds the right key and calls the AI engine. The e2e test checks that no client file contains a key or calls Anthropic directly.

The proxy uses `claude-sonnet-5-5` with low effort, since chat answers are short, and server-side refusal fallbacks (`fallbacks: "default"`). The calorie camera also uses Sonnet when it gets to Anthropic; **only the body-fat estimate runs on `claude-opus-5-5`**, because accuracy there sets the starting calories. Change one task with `CLAUDE_MODEL_CHAT`, `CLAUDE_MODEL_MEALPHOTO` or `CLAUDE_MODEL_BODYFAT`, or all of them with `CLAUDE_MODEL`.

It also guards the endpoint:
- **Size limits:** request body, message count, message length and context size.
- **Origin check:** same-origin requests always pass; any other origin must be listed in `ALLOWED_ORIGINS`.
- **Rate limit:** 30 requests per 10 minutes per IP, kept in each Worker instance's memory, so it's only a rough guard. For real protection, uncomment `[[ratelimits]]` in `wrangler.toml`; `api.js` picks it up automatically.

## Deploy (Cloudflare, one origin for app + API)

```bash
cd nutrition-app
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy                # → https://nutri.<your-subdomain>.workers.dev
```

A PWA must be served over HTTPS to install; `workers.dev` and custom domains are. `www/_headers` applies a strict CSP and security headers. If you edit the inline theme script in `index.html`, update its hash (the command is in the file).

**Hosting the app elsewhere** (Netlify, GitHub Pages, …): deploy `www/` as static files and deploy the Worker on its own. Then set `API_BASE` in `www/js/config.js` to the Worker URL, and add the app's origin to `ALLOWED_ORIGINS` in `wrangler.toml`.

## Wrap as a native app later (Capacitor)

The app was built for this: no bundler, hash routing (no server rewrites), the web root is `www/` (already set as `webDir`), and all state lives in IndexedDB, which the native WebView keeps.

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap add android && npx cap add ios
npx cap sync
```

Then make three changes:
1. **`www/js/config.js`:** set `API_BASE` to your deployed Worker URL, and add `capacitor://localhost,https://localhost` to `ALLOWED_ORIGINS`.
2. **`notify.js`:** swap in `@capacitor/local-notifications` for a reliable weekly reminder. Only this module touches notifications.
3. **`screens/photo-picker.js`** (optional): swap in `@capacitor/camera`. Only this module touches the camera.

## Decisions I made

| Area | Choice | Why |
|---|---|---|
| Stack | Plain HTML/CSS/JS ES modules, no framework, no build | Nothing to install or break, opens instantly, works offline, and Capacitor can wrap `www/` as-is. Screens are small DOM functions. |
| Storage | **IndexedDB, local-first**. No accounts, no backend database. | Photos and body metrics are sensitive. Keeping them on the device is the most private option, works offline, stores photos as real Blobs, and survives restarts. The app also asks for persistent storage. |
| Backend | One Cloudflare Worker: static app + `/api/chat` | The only server job is hiding the API key. The same handler runs on Node locally. |
| Calories | Katch-McArdle (body fat is collected); Mifflin-St Jeor as fallback | Daily-life activity factor (1.2–1.5) plus 0.035 per weekly workout, to avoid double-counting exercise. |
| Safety limits | Cut ≤ 1% of body weight per week, deficit ≤ 30% of TDEE and ≤ 69 kcal per kg of fat mass. Bulk ≤ 0.5% per week, surplus ≤ 500 kcal. Floor = max(BMR, 1500 for men / 1200 for women). Target BMI ≥ 18.5; target body fat ≥ 6% (men) / 14% (women). | Unrealistic goals get a warning with one-tap alternatives: a longer period or a reachable target. |
| Macros | Protein 2.5 g/kg lean mass on a cut, 2.2 g otherwise; fat 25–28% of calories (at least 0.6 g/kg); carbs make up the rest | |
| Re-pacing | Every weigh-in recomputes the rate from the time left in the period | Ahead of schedule → you eat a bit more; behind → a bit less, always within the limits. |
| Weekly week | Week *n* is due on day 7*n* after registration | Week 0 is an **optional** baseline photo during onboarding, which makes before/after useful from day one. From week 1 on, the gate is mandatory. |
| Reminders | Periodic Background Sync, plus a weekly calendar event (.ics) | The web cannot schedule a future local notification. Periodic sync works only for an installed app on Chrome/Android; the .ics alarm works everywhere, including iPhone. |
| Assistant disclaimer | Pinned disclaimer on the chat screen; the model adds a one-line "not medical advice" whenever a question touches health | One on every reply was noisy. Say if you want it on every reply. |

### Foods you don't eat, and the weekly shopping list

- **Removing foods:** any food can be taken off the menu from its "replace" sheet ("I don't eat this"). There's also a full picker in Profile → Food preferences, and in sign-up. Each category (protein, carb, fat, vegetables, fruit) always keeps at least 2 foods, so every menu item always has a substitute. The swap search also relaxes its limits rather than ever returning nothing.
- **A different menu every day:** a menu week follows the check-in week and is planned as a whole. Each meal's main dish rotates through its options, so no meal repeats its main within the week and no main appears twice in a day; vegans with a soy allergy are the exception, with only ~5 suitable proteins. Sides (carbs, fats, vegetables, fruit) rotate within a small weekly set, which keeps the shopping list at about 30–50 products.
- **Shopping list** (Menu → 🛒 Weekly shopping): adds up the rest of this week, or the whole of next week, including any swaps you made. Amounts are converted to what you buy: dry rice and grains, raw meat, whole eggs, avocados and fruit by the piece, and mixed salads split into vegetables. They're rounded to real packages and grouped by supermarket section. Tick items as you shop; the list can be shared to WhatsApp or copied.

### "Don't know your body fat?" (photo estimate)

- **Where it appears:** sign-up, the weekly check-in and Profile each offer "don't know your body fat?".
- **Capture:** a guided camera takes 4 photos (front, left, back, right) with a 3/5/10-second self-timer and an outline to stand inside. Without a camera, photos can be uploaded instead.
- **Consent first:** the user agrees before anything is sent. The photos go once, through your Worker (`/api/bodyfat`), to Claude for analysis. They're never stored on the server or in the app.
- **Answer format:** the model answers in a fixed JSON schema: estimate, range, confidence and short notes, or a reason when the photos can't be used.
- **Optional tape measurements:** waist, neck, and hip for women (the US Navy method). If given, they're averaged with the photo estimate.
- **Fallbacks when analysis is unavailable:** the tape method if measured, otherwise a rough BMI-and-age formula (Deurenberg). It's always labelled with which method was used.
- **Disclaimer:** shown before capture and next to the result. There's no guarantee of exact numbers, and a dietitian or a professional measurement is recommended for an exact figure.

### Keto and carnivore

- **Keto:** no grains, bread, starchy vegetables, legumes or fruit. Carbs are capped at about 50 g total (20–30 g net) and fat fills the rest. Meals are protein, two fats and low-carb vegetables.
- **Carnivore:** animal foods only (meat, poultry, fish, eggs, dairy). Carbs are near zero, and meals are protein and two fats.
- **New foods:** butter, entrecote, 20% ground beef and hard cheese.
- **Explanations:** choosing either diet shows what it means, and carnivore recommends checking with a doctor.

### Recipes for every meal

- Every meal card has **🍳 Recipes for this meal**. The recipes come from `www/js/recipes.js`, a recipe engine rather than a fixed list.
- **How recipes are built:** the meal's own ingredients, at exactly the planned grams, or their substitutes. Each is combined with a cooking method suited to that food (oven, pan, air fryer, grill, stir-fry, shakshuka-style sauce, bowls, sandwiches, wraps, meatballs, stews, soups, spreads, porridge, shakes, pancakes…) and one of ~29 flavour profiles. Only spices, herbs, lemon and garlic are added.
- **Volume:** a typical meal gets 500–4,000 recipes; even the most restricted diets get 40+ per meal. The order reshuffles daily, so the list feels new.
- **Filters** (remembered between visits):
  - what I have at home: about 40 spices and basics, plus "only recipes I have everything for"
  - favourite style: Israeli, Mediterranean, Italian, Asian, Mexican, Indian, BBQ, European, sweet
  - cooking tool, prep time, no spicy food
  - only the menu's own ingredients
  - ❤ favourites, and free-text search
- **Using a recipe with a substitute:** one tap updates the menu (and so the shopping list).
- **"Brand-new idea from the assistant"** asks Claude for a recipe from the same ingredients and amounts.
- **Quality checks:** a scan of ~1,000,000 generated recipes checks the Hebrew constructions (articles, ב-prefix merging, doubled words, units) and finds no issues. It covers 7 diets × 7 days, with and without each food group removed. Unit tests check the amounts, restrictions and filters.

### Taking a food group out of a meal

- Under every meal: **בלי חלבון / בלי פחמימה / בלי שומן / בלי ירקות / בלי פרי**. Tap once to remove, tap again to bring it back. The choice applies to that meal on that day, and stays when you tap "another meal".
- **Nothing is added in its place.** The meal keeps the same foods it had, minus the removed group, in bigger portions. One exception: if the removal would leave only seeds or oil and salad, the carb that was picked for that meal comes back. A removal never changes any other meal.
- **Where the calories go:** the removed macro's calories are shared among the remaining macros, in proportion to how many calories each already had. For example, a lunch without carbs gives the carb calories to protein and fat, with more going to fat if fat was the bigger share. Portions are then re-solved, and the remaining foods may go up to 1.8× their usual portion so the meal keeps its calories. A note on the card says how many calories moved and where.
- **Limits:**
  - Vegetables and fruit can always go, together with anything.
  - Of protein, carbs and fat, only one goes at a time. Picking a second swaps it for the first.
  - Never in a way that leaves only fat (e.g. keto without protein), because a meal of oil and nuts isn't a meal.
- Measured over ~4,000 meals: the median meal lands within ~1% of its calories. The exceptions are tiny snacks, where one food's minimum portion is already above the snack's calories.
- The shopping list, recipes and the assistant all follow the removals. Meals without protein get carb-based recipes: stir-fries, grain salads, baked potatoes, wraps, porridge, fruit bowls, smoothies.

### Replacing an item: every option

The replace sheet shows the 6 closest matches first. **לראות את כל האפשרויות (N)** then lists every food of that kind the user can eat, each scaled to the same amount of protein, carbs or fat, in one scrolling list. Foods that would need an unrealistic amount are capped at a sensible portion and listed last.

### More food options (v1.4)

143 foods, up from 76 (38 protein, 27 carb, 25 fat, 19 vegetable, 34 fruit). Each has shopping-list info, recipe support and correct Hebrew forms.
- **Protein:** ground chicken and turkey, sirloin, trout, hake, Bulgarian cheese, skyr, protein pudding, soy chunks, white beans
- **Carbs:** barley, millet, ptitim, whole-wheat / gluten-free pasta, rice noodles, peas, whole-wheat bun, crispbread
- **Fats:** pistachios, hazelnuts, peanuts, sunflower and sesame seeds, almond butter, canola oil, hummus, mozzarella, feta, cream cheese, ghee
- **Vegetables:** cucumber, tomato, peppers, zucchini, eggplant, cabbage, asparagus, Brussels sprouts, pumpkin, beets
- **Fruit:** mango, watermelon, melon, peach, pineapple, plums, pomegranate, clementines, strawberries
- **More fruit (v1.4.2):** persimmon, figs, apricot, cherries, nectarine, grapefruit, pomelo, lychee, passion fruit, guava, papaya, blueberries, raspberries, loquat, raisins, dried apricots, prunes

### One protein per meal, always (v1.4.3)

A meal never gets a second protein.
- **Choosing the main:** it's picked among proteins that can carry ~85% of the meal's protein alone (keto/carnivore: 60%). That means enough in a sensible serving, and lean enough to do it within ~¾ of the meal's calories, so no entrecôte for a cutting dinner.
- **When a main still falls short:** the weekly planner swaps a weak main (lentils for a big lunch) for a strong one this meal doesn't use on any other day. On the day itself, the main may grow up to 1.5× its usual portion. As a last resort it is replaced by a protein no meal has that week. Daily variety always wins over the last few grams of protein.
- **Where protein can fall short:** omnivores, keto and carnivore stay at 92%+ of the protein target, and pescatarian at ~88%. Vegetarian (~80%) and vegan (~60–70%, especially without soy and gluten) can come in lower, because legumes can't carry a large meal's protein alone. The profile assessment and the assistant can suggest a protein shake or a lower target there.

Meals also stick to foods that belong in them. Breakfast and snacks only borrow proteins from each other, and lunch and dinner likewise. A meal only borrows carbs from other meals when restrictions leave it fewer than two options.

### Fruit in every meal (v1.4.3)

Every meal comes with one fruit, a normal serving: breakfast, lunch, dinner and snacks. It's never two; snacks no longer use a fruit as their carb. Each fruit can be swapped, or taken out with **בלי פרי**. Keto and carnivore have no fruit.

### Calorie camera (v1.5)

Every meal card on today and past days has **מצלמת קלוריות — צלמו את הצלחת** at the top.

1. **Photo:** the back camera opens with a round guide ("the whole plate inside the circle, from above"). There are tips to include side plates, sauces, bread and drinks, and to put a fork next to the plate for scale. An existing photo can be uploaded instead. The first use asks for consent to send the photo for analysis.
2. **Analysis** (`/api/meal-photo`): one call to a free AI engine that can see images (see "AI engines"), with the JSON schema in the prompt. It gets the photo, the planned meal (context only, never assumed) and the app's food list. **Never Anthropic by default**, to save credits.
   - **What it's told to list:** every item in the frame, including cooking oil, dressings, sauces, spreads and toppings; people under-count these most.
   - **How it estimates:** cooked weights in grams, using the plate, cutlery and standard portions for scale.
   - **What it returns per item:** kcal, protein, carbs, fat, a confidence level, and a matching food id when the item is one the app knows.
   - **Server checks:** the server validates and clamps everything, and drops unknown ids.
3. **Fixing the list:**
   - Change any amount in grams; the calories recalculate.
   - Rename an item: pick one of the app's foods from the suggestions and it switches to that food's values, or type a free name.
   - Delete items, or add one: a known food, or a custom one with kcal per 100 g.
   - Uncertain items are highlighted.
   - Foods the app knows are computed from its own food table, so a photographed chicken breast counts exactly like the planned one.
4. **Confirm.** The plate is compared with the planned meal. Any unplanned item over 20 kcal (sauce, oil and so on), any missing planned food, or calories more than 15% off counts as different.
   - **Matches:** the meal is marked eaten.
   - **Differs:** the app shows what's different and asks *"update the meal to what you ate?"*.
     - **Yes:** the meal card shows the photographed items (badge "לפי הצילום", with the planned calories alongside). Today's calories count what was eaten, and **חזרה לארוחה המתוכננת** undoes it.
     - **No:** back to the camera. Nothing is logged until a plate is confirmed.

Closing the camera at any point logs nothing. The photo is never saved: it lives in memory, goes to the server once for analysis, and is discarded. The shopping list keeps using the planned meal. The assistant sees what was actually eaten.

### AI engines: free providers first (v1.6)

`server/engines.js` puts many providers behind one call. Every key is optional; set the ones you have, each as a Worker secret (`npx wrangler secret put GOOGLE_API_KEY`) or let `UPLOAD-APP.bat` ask for them.

| Engine | Env | Sees images |
|---|---|---|
| Google (Gemini) | `GOOGLE_API_KEY` | yes |
| Mistral | `MISTRAL_API_KEY` | yes |
| GitHub Models | `GITHUB_MODELS_TOKEN` | yes |
| Groq | `GROQ_API_KEY` | yes |
| NVIDIA | `NVIDIA_API_KEY` | yes |
| OpenRouter (`:free` models) | `OPENROUTER_API_KEY` | yes |
| xAI | `XAI_API_KEY` | yes |
| Cerebras | `CEREBRAS_API_KEY` | no |
| Cloudflare Workers AI | the `[ai]` binding in `wrangler.toml`, no key (a small daily allowance) | no, text only |
| Anthropic | `ANTHROPIC_API_KEY` | yes |

**Who may do what**

| Task | Engines |
|---|---|
| Assistant chat and recipe ideas | all of them: free ones first, in rotation; Anthropic only as the last resort when every free engine failed |
| Calorie camera | the free engines that can see images, in rotation; Anthropic only as the last resort when every free engine failed |
| Body-fat estimate | the other way round: **Anthropic first** (accuracy sets the starting calories), and the free vision engines take over when it is out of credits or down. An empty Anthropic balance rests it for 30 minutes, so the next requests go straight to the free engines |

Set `CHAT_ALLOW_ANTHROPIC=0`, `MEALPHOTO_ALLOW_ANTHROPIC=0` or `BODYFAT_ALLOW_ANTHROPIC=0` on the server to keep a task off Anthropic.

**How it behaves**
- **Rotation:** requests rotate across the free engines, so each provider's allowance is used evenly.
- **Resting:** a provider that answers 429/402 rests for 5 minutes, a rejected key for 30, an outage for 1. The request moves on to the next engine. A request too big for one provider (413/400) doesn't make it rest. State is per Worker instance, like the rate limiter.
- **Structured output (calorie camera):** the JSON schema goes in the prompt, with `response_format: json_object` where the provider accepts it (retried without it otherwise). Fenced or chatty replies are cleaned, and an answer of the wrong shape moves on to the next engine.
- **Light on quota and fast (calorie camera):**
  - **Image:** 768 px at JPEG quality 0.65, a fraction of the size of the first version (1280 px, 0.8).
  - **Request text:** the app's foods go as ids only (not Hebrew names), and the prompt is short, with a one-line example in place of the full JSON schema. About 65% fewer text characters per request.
  - **Output:** capped at 1,500 tokens and 12 items.
  - **Reasoning:** `reasoning_effort: low`, since a quick look at a plate needs no long reasoning. A provider that answers 400 to it (or to `response_format`) is asked again without it and remembered.
  - **Slow engines:** an engine that takes over 25 s goes to the back of the rotation for 10 minutes, and the per-engine timeout for images is 45 s.
- **Free engines are weaker:** the calorie camera never reports "high" confidence from one, calories that contradict an item's own macros are pulled toward them and the item is flagged, and the result screen says it came from a free model. The user edits the list anyway.
- **One key per provider.** Several accounts at one provider to get around its limit breaks its terms and can get every key blocked.
- **Free-tier model names change.** Override any with `<VENDOR>_MODEL` / `<VENDOR>_VISION_MODEL`, and limit a task with `ENGINES_CHAT=google,groq` / `ENGINES_MEALPHOTO=...`.
- `/api/health` lists which engines are configured (ids only, never keys).

### Paid plan for the AI features (v1.7, payments not connected yet)

- **Paid** ("נוטרי פלוס"): the assistant (chat, substitution questions, recipe ideas) and the calorie camera, the features that spend AI quota.
- **Free:** everything else, including the body-fat estimate, the menu, recipes, shopping and swaps.
- **Trial:** every user gets `BILLING.trialDays` days (currently 0: no trial while testing; set it back to 7 to restore it) of the AI features from registration. Then the assistant and the camera open the payment screen instead. A substitution question still gets the equivalents computed on the device.
- **Payment screen:**
  - two plans (prices are placeholders in `config.js`)
  - payment buttons for the device: **Apple Pay** on iPhone/iPad, **Google Pay** on Android, **card** and **PayPal** everywhere
  - the VAT and auto-renewal line
- **Connecting a provider:** set `BILLING.provider` and `BILLING.checkoutUrl` (the provider's hosted checkout). `checkoutLink()` in `billing.js` is the one place that sends the buyer there, so card details never pass through the app. Until then, every button says payments aren't connected yet. The subscription is read from `settings.subscription` (`{ plan, until, method }`).
- **Before charging real money:**
  - **Accounts and a server record of who paid.** The provider's webhook should reach the Worker, and the AI endpoints should check the subscription. Today the check runs on the device only, so it is easy to bypass.
  - **Store builds:** an App Store build must sell the plan through Apple's in-app purchase instead.

### Messages (v1.12)

- **Asking:** once, on the first visit to Today after setup, one plain question: "מאשרים לנוטרי לשלוח לכם הודעות?", with "מאשר" and "לא מאשר". It deliberately doesn't say what will be sent. Either answer, or closing the sheet, counts as asked. The switch in Profile ("הודעות מנוטרי") turns it on or off any time.
- **What is sent** (not shown to the person):
  - **13:00:** "אל תשכחו לעדכן את ארוחת הצהריים שלכם", only if lunch isn't marked eaten.
  - **20:00:** the same for dinner.
  - **09:00 and 17:00:** two light nudges so the app isn't forgotten. The morning one is skipped if something is already marked; the afternoon one if dinner is done. Neither is sent within 90 minutes of the app being opened.
  - Times are the device's own time zone, so 13:00 stays 13:00 across the clock change.
- **How it works (real Web Push, no third-party service):**
  - The device subscribes, and sends the Worker its push address, its time zone and four booleans (which meals are marked today).
  - A cron trigger (`wrangler.toml`, every 15 minutes) runs `runReminders()` in `server/push.js`. It sends an **empty** push to each device whose local time just reached a reminder, and the service worker shows the text.
  - The VAPID key pair is made on first use and stored in KV, so there is no secret to set up. The Worker only talks to the browser makers' push services.
  - The KV namespace `PUSH` is created by `wrangler deploy` the first time. If messages don't appear after deploying, run `npx wrangler kv namespace create PUSH` and put the id in `wrangler.toml`.
- **Limits:**
  - **iPhone:** only for an installed app (Share, then Add to Home Screen), iOS 16.4 or later. Before that the sheet explains it.
  - **Not tested against a real push service.** The tests cover the server logic (including the VAPID signature), the subscription flow with a stand-in browser push service, and the notification text.
  - **Scale:** the free KV plan covers about a thousand devices at a 15-minute cron.
  - The weekly photo reminder is separate (Periodic Background Sync and the calendar file).

### Search, drinks and sauces (v1.11)

- **Search in "replace an item":** a search bar on top of the swap sheet. Typing a name searches every food of that kind (names and aliases), not just the short list.
- **Drinks ("שתייה") under every meal** of today and past days:
  - a free-text field ("מה שתיתם?") with suggestions, plus two optional fields: **sugar (teaspoons per cup)** and **how many cups**
  - the text is matched against a table of about 25 common drinks (`drinks.js`, per cup) to get calories; the longest match wins, so "קפה עם חלב" beats "קפה"
  - a drink the table doesn't know is saved with 0 calories and the person types the calories of one cup
  - drinks count toward the day's calories and macros as soon as they're added (ring and bars on Today), whether or not the meal is marked eaten
  - one teaspoon of sugar is 16 kcal and 4 g carbs
- **Sauces and cheese ("הוספת רוטב או גבינה") on every meal:**
  - the list (`extras.js`) has about 25 sauces and 5 cheeses, filtered by diet, allergies, kosher (no dairy beside meat) and keto (at most 3 g carbs a serving)
  - low-calorie sauces (25 kcal or less a serving) come first, lowest first, then the rest, then cheeses
  - the **calories come off the rest of the meal**: the other foods shrink (down to half their usual minimum if they must) so the meal stays on its budget. Meals with a removed group work the same way
  - up to 4 per meal; each can be made smaller or bigger, or removed
  - they are kept apart from the food table, so they never appear in generated menus, swaps, recipes or the weekly shopping list
- **Not done yet:** the assistant doesn't know about the drinks or the added sauces, and the shopping list doesn't include the sauces.

### Cloud accounts: sign in with Google (v1.8)

Accounts are on once `CLOUD.url` and `CLOUD.anonKey` are set (they are, for the project in config.js) in `www/js/config.js`. Until then the app has no sign-in button and works exactly as before, on the device only.

**What the user gets**

- **First screen (v1.10):** a new person sees three choices, and nothing else until they pick:
  - **התחברות:** Google sign-in, expecting data in the account. It restores the plan, or says no account with data was found and starts a new plan.
  - **יצירת חשבון:** Google sign-in for a new account, then the registration. If the account turns out to have data already, it is loaded instead.
  - **המשך ללא חשבון:** guest mode, everything on this device only. The choice is remembered, and the welcome screen has a way back to the choices.
  - Google doesn't ask whether you meant to sign in or sign up, so the first two buttons share one sign-in. They differ only in what happens afterward.
  - The screen shows only when `CLOUD` is set, nobody is signed in and the person hasn't chosen guest. After "delete all data" it comes back.

- **Profile → "גיבוי וחשבון" → "התחברות עם Google".** The data on the device is uploaded to their account.
- **On a new phone:** the welcome screen has "יש לי חשבון — התחברות עם Google". After sign-in the plan, logs, weigh-ins, chat, settings and profile picture come back and the app opens on Today.
- **Sync:** every change goes up a moment later; opening the app pulls the newer copy. The whole state is one document and the newest copy wins. Two devices edited offline at the same moment keep the later one.
- **Both sides have data** (a device with its own plan signs in to an account that has one too): nothing is overwritten. The user picks "load from the account" or "keep this device's data".
- **Progress photos stay on the device** unless the user turns on "גיבוי תמונות ההתקדמות". Turning it off deletes the cloud copies. The profile picture always syncs.
- **Sign-out** keeps the data on the device, or deletes it from the device (for a phone that isn't yours). The account keeps its copy.
- **Delete all data,** while signed in, also deletes the cloud files, the data row and the account itself.

**How it works**

- **Supabase:** Auth (Google), Postgres and Storage, called over plain HTTPS from `cloud.js`. There is no SDK, because the app has no build step.
- **Sign-in:** OAuth with PKCE, so there is no client secret anywhere.
- **Data:** `sync.js` decides what goes up and what comes down; `store.snapshot()` and `store.applySnapshot()` are the data in and out.
- **Protection:** the anon key in `config.js` is public by design. Row-level security in `supabase/setup.sql` limits each signed-in user to their own row and their own folder, `<user id>/…`, in a private bucket.

**Setting it up (about 20 minutes, free tier)**

1. **Create a project** at supabase.com.
2. **Run the setup SQL:** open SQL Editor → New query, paste `supabase/setup.sql`, and click Run.
3. **Create the Google credentials** in Google Cloud Console:
   - APIs & Services → Credentials → Create OAuth client ID → Web application.
   - Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
4. **Turn on Google in Supabase:** Authentication → Sign In / Providers → Google. Paste the client ID and secret. The secret lives in Supabase only, never in the app.
5. **Set the app's address in Supabase:** Authentication → URL Configuration. Set Site URL to the app's address and add it under Redirect URLs (for example `https://nutri.<you>.workers.dev/`).
6. **Fill in `www/js/config.js`:** under `CLOUD`, set `url` (Project Settings → API → Project URL) and `anonKey` (the anon / publishable key).
7. **Upload the app again** with `UPLOAD-APP.bat`. The CSP in `www/_headers` already allows `https://*.supabase.co`.

**Still open**

- **App Store builds:** an App Store build that offers Google sign-in must also offer Sign in with Apple. Supabase supports it; it's not wired yet.
- **Server-side paid plan:** the Worker can now know who is calling. Checking the paid plan on the server, once payments are connected, is the next step.

### Weekly-gate rules (what "can't be bypassed" means here)

- The gate decision is made in one function, `render()` in `app.js`. It runs on every route change, return from the background, focus, bfcache restore, and every 30 seconds.
- While the gate is due, nothing else renders. The tab bar is hidden and inert, open sheets close, and deep links, the back button and hash edits all land on the gate.
- The flow is photo → weight and body fat (both required and validated) → summary.
- **Resume:** the photo is saved as soon as it's taken, so closing the app mid-way resumes at step 2.
- **Missed weeks:** only the current week is required; missed weeks show as empty in the gallery.
- **Clock rollback:** setting the device clock back more than 26 hours is ignored; the app uses the latest time it has seen. Smaller jumps are allowed for time-zone travel.
- **Removing the gate in DevTools:** it re-appears.
- **Gallery:** individual photos can't be deleted, only all data at once, from Profile.
- **Limit:** a determined user can still edit the device's database with developer tools. A local-first app can't prevent that; only a server-side record could.

## Tests

```bash
npm test              # 101 unit tests: formulas, safety caps, gate math, restriction compliance across 126 generated days, swaps, food-group removal, proxy, PKCE
npm run test:e2e      # 216 browser checks (needs a Playwright Chromium: `npx playwright install chromium`)
npm run test:cloud    # 37 browser checks: the first screen, Google sign-in, sync across devices, photo backup, conflicts, sign-out, delete; profile picture and nickname
```

The e2e run uses a stubbed Claude API, so it needs no key and costs nothing. The cloud run uses an in-memory fake of the Supabase APIs. It controls the device clock to move through weeks and saves screenshots to `tests/e2e/screenshots/`.

## Privacy

- **On the device, and in your account only if you sign in:**
  - your profile, every weigh-in and the chat history
  - progress photos, which go to the account only with photo backup on
  - there are no analytics
- **Sent to the assistant:** age, sex, height, current metrics, goal, daily targets, restrictions and today's menu. Never your name, photos or registration date. The request goes through your Worker to whichever AI engine answers, a free provider or Anthropic. Free plans of some providers may use content to improve their models.
- **Sent to the calorie camera:** the plate photo, which the Worker forwards once to a free vision provider (Anthropic only if every free one failed). It is not stored by the app, but free-plan providers may use it for training. The consent screen says so.
- **Body-fat photos go to Anthropic first.** If it is out of credits or down, they go to a free vision provider, which may use them for training; the consent screen says so, and the result says when a fallback service made the estimate (and never reports high confidence from one). This changed in v1.13: before, they never reached a free provider.
- **Delete all data** (Profile, then type "מחק" to confirm) erases the database, settings and chat from the device. While signed in it also erases the cloud copy and the account.
- **No AI vendor names in the app.** The consent texts say the photos go to external analysis services without naming them, and the assistant is told not to say which model it runs on.

The app shows that it is not medical advice, during onboarding, in the chat and in Profile.

## Languages (v1.14.0)

English is the default (app name, logo text and every string). The language picker is on the first screen and in the profile. Packs: English, Hebrew, Spanish, French, German, Portuguese, Italian, Russian, Arabic (RTL). Packs live in `www/js/lang/`; check one with `node tools/i18n/check.mjs <lang>`; tour every screen with `LANGS=en,he,ar node tests/e2e/i18n.mjs`. Translations were machine-drafted and machine-reviewed, not checked by native speakers.

## Barcode scanner (v1.16.0)

"Add your own food" has a **Scan a barcode** button: the camera (or a photo, or typed digits) reads the code with ZBar (WebAssembly, vendored in `www/vendor/zbar`, LGPL-2.1), `/api/barcode` looks the product up in [Open Food Facts](https://world.openfoodfacts.org) (ODbL; credited in the product sheet) and caches it for a day, and the person picks grams, servings or the whole package. The CSP gained `'wasm-unsafe-eval'` for the reader. `node tests/e2e/barcode.mjs` tests the reader on a real video (needs ffmpeg).

## Inbox and friends (v1.17.0)

- **Inbox** (bell on Today): app messages kept on the device, and — in a separate folder — friend requests.
- **Friends**: a public profile with a username (`@name`), invite link `#/u/<username>` (WhatsApp / copy), search by username, requests to accept or decline. Needs the new tables: **re-run `supabase/setup.sql`** in the Supabase SQL editor (adds `nutri_profiles` and `nutri_friend_requests` with row-level security; wins/losses can only be changed by the server). Tested against an in-memory fake of the PostgREST calls (`tests/e2e/cloud.mjs`), not against a real project.
