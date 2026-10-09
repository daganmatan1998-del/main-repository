// Light / dark / follow-system. The choice is mirrored to localStorage so the
// inline script in index.html can apply it before first paint (no flash).

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try { localStorage.setItem('nutri-theme', theme); } catch { /* ignore */ }
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', dark ? '#0f1715' : '#f4f7f5');
}
