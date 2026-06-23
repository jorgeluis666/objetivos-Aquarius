(function () {
  const STORAGE_KEY = 'amador-sidebar-collapsed';
  const DESKTOP_QUERY = '(min-width: 761px)';

  function getStoredState() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveState(collapsed) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // El dashboard también debe funcionar si el navegador bloquea localStorage.
    }
  }

  function initSidebar() {
    const shell = document.querySelector('.shell');
    const toggle = document.querySelector('[data-sidebar-toggle]');
    if (!shell || !toggle) return;

    const desktopMedia = window.matchMedia(DESKTOP_QUERY);
    let collapsed = getStoredState();

    function render() {
      const isCollapsed = collapsed && desktopMedia.matches;
      shell.classList.toggle('sidebar-collapsed', isCollapsed);
      toggle.setAttribute('aria-expanded', String(!isCollapsed));

      const label = isCollapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
    }

    toggle.addEventListener('click', function () {
      collapsed = !collapsed;
      saveState(collapsed);
      render();

      window.setTimeout(function () {
        window.dispatchEvent(new Event('resize'));
      }, 250);
    });

    desktopMedia.addEventListener?.('change', render);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }
})();
