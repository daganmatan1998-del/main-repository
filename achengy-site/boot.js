/* Runs before first paint: flags JS, restores the "stop animations" choice,
   and decides whether the first-visit loader shows. Storage may be blocked. */
(function () {
  var h = document.documentElement;
  h.classList.add('js');
  try { if (localStorage.getItem('achengy-no-motion') === '1') h.classList.add('no-motion'); } catch (e) {}
  try {
    var calm = h.classList.contains('no-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!calm && !sessionStorage.getItem('achengy-seen')) h.classList.add('first-visit');
  } catch (e) {}
})();
