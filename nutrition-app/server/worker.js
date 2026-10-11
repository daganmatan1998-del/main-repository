// Cloudflare Worker entry: /api/* goes to the chat proxy, everything else is
// served from www/ by Workers Static Assets (see wrangler.toml).

import { handleApi } from './api.js';
import { runReminders } from './push.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  // Cron trigger (wrangler.toml): the daily reminders, see push.js.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};
