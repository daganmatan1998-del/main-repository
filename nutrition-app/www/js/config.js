// Runtime configuration. The only file that changes between web and native builds.
//
// API_BASE: where the chat proxy lives.
//   ''  -> same origin (the Cloudflare Worker serves both the app and /api/chat,
//          and the local dev server does the same).
//   'https://nutri-api.<you>.workers.dev' -> when the app is hosted elsewhere,
//          or wrapped with Capacitor (native apps have no same-origin server).
export const API_BASE = '';

export const APP_VERSION = '1.1.0';
