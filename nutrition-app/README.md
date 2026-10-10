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
│   │   ├── foods.js         food database (126 foods), diet/allergy/kosher rules
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
cp .env.example .env          # put your Anthropic API key in .env
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

The browser never sees the key. The app calls `/api/chat` on its own origin, and `server/api.js` adds the key and calls Claude. The e2e test checks that no client file contains a key or calls Anthropic directly.

The proxy uses `claude-opus-5-5` with low effort, since chat answers are short, and server-side refusal fallbacks (`fallbacks: "default"`). Set the `CLAUDE_MODEL` variable to change the model.

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

- Under every meal: **בלי חלבון / בלי פחמימה / בלי שומן / בלי ירקות**, plus **בלי פרי** at breakfast. Tap once to remove, tap again to bring it back. The choice applies to that meal on that day, and stays when you tap "another meal".
- **Nothing is added in its place.** The meal keeps the same foods it had, minus the removed group, in bigger portions. One exception: if the removal would leave only seeds or oil and salad, the carb that was picked for that meal comes back. A removal never changes any other meal.
- **Where the calories go:** the removed macro's calories are shared among the remaining macros, in proportion to how many calories each already had. For example, a lunch without carbs gives the carb calories to protein and fat, with more going to fat if fat was the bigger share. Portions are then re-solved, and the remaining foods may go up to 1.8× their usual portion so the meal keeps its calories. A note on the card says how many calories moved and where.
- **Limits:**
  - Vegetables and fruit can always go, together with anything.
  - Of protein, carbs and fat, only one goes at a time. Picking a second swaps it for the first.
  - Never in a way that leaves only fat (e.g. keto without protein), because a meal of oil and nuts isn't a meal.
- Measured over ~4,000 meals: the median meal lands within ~1% of its calories. The exceptions are tiny snacks, where one food's minimum portion is already above the snack's calories.
- The shopping list, recipes and the assistant all follow the removals. Meals without protein get carb-based recipes: stir-fries, grain salads, baked potatoes, wraps, porridge, fruit bowls, smoothies.

### Fruit at breakfast

Breakfast now has a fruit as its own category: a normal serving next to the bread or oats, rotated through the week like the other sides. It can be swapped like any item, or taken out with **בלי פרי**. Keto and carnivore breakfasts have no fruit.

### Replacing an item: every option

The replace sheet shows the 6 closest matches first. **לראות את כל האפשרויות (N)** then lists every food of that kind the user can eat, each scaled to the same amount of protein, carbs or fat, in one scrolling list. Foods that would need an unrealistic amount are capped at a sensible portion and listed last.

### More food options (v1.4)

126 foods, up from 76 (38 protein, 27 carb, 25 fat, 19 vegetable, 17 fruit). Each has shopping-list info, recipe support and correct Hebrew forms.
- **Protein:** ground chicken and turkey, sirloin, trout, hake, Bulgarian cheese, skyr, protein pudding, soy chunks, white beans
- **Carbs:** barley, millet, ptitim, whole-wheat / gluten-free pasta, rice noodles, peas, whole-wheat bun, crispbread
- **Fats:** pistachios, hazelnuts, peanuts, sunflower and sesame seeds, almond butter, canola oil, hummus, mozzarella, feta, cream cheese, ghee
- **Vegetables:** cucumber, tomato, peppers, zucchini, eggplant, cabbage, asparagus, Brussels sprouts, pumpkin, beets
- **Fruit:** mango, watermelon, melon, peach, pineapple, plums, pomegranate, clementines, strawberries

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
npm test              # 39 unit tests: formulas, safety caps, gate math, restriction compliance across 126 generated days, swaps, food-group removal, proxy
npm run test:e2e      # 161 browser checks (needs a Playwright Chromium: `npx playwright install chromium`)
```

The e2e run uses a stubbed Claude API, so it needs no key and costs nothing. It controls the device clock to move through weeks and saves screenshots to `tests/e2e/screenshots/`.

## Privacy

- **On the device only:** your profile, every weigh-in, every photo and the chat history. There is no account and no analytics.
- **Sent to the assistant:** age, sex, height, current metrics, goal, daily targets, restrictions and today's menu. Never your name, photos or registration date. The request goes to Anthropic through your Worker.
- **Delete all data** (Profile, then type "מחק" to confirm) erases the database, settings and chat from the device.

The app shows that it is not medical advice, during onboarding, in the chat and in Profile.
