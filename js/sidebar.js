(function () {
  const STORAGE_KEY = 'rb-sidebar-collapsed';
  const LEGACY_STORAGE_KEY = 'aquarius-sidebar-collapsed';

  function getStoredState() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (value !== null) return value === '1';
      return window.localStorage.getItem(LEGACY_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveState(collapsed) {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // El dashboard también debe funcionar si el navegador bloquea localStorage.
    }
  }

  function wireSidebarToggle() {
    const shell = document.querySelector('.shell');
    const sidebar = document.getElementById('aquarius-sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    if (!shell || !sidebar || !toggle) return;

    const items = Array.from(sidebar.querySelectorAll('.s-item'));
    let collapsed = getStoredState();

    function render() {
      shell.classList.toggle('sidebar-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));

      const label = collapsed ? 'Expandir panel' : 'Minimizar panel';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);

      // En la franja minimizada solo quedan los íconos: el nombre del módulo pasa a tooltip.
      items.forEach(function (item) {
        const title = item.querySelector('.s-title-nav');
        if (collapsed && title) {
          item.setAttribute('title', title.textContent.trim());
        } else {
          item.removeAttribute('title');
        }
      });
    }

    toggle.addEventListener('click', function () {
      collapsed = !collapsed;
      saveState(collapsed);
      render();

      // Los gráficos de Chart.js recalculan su ancho al terminar la animación del panel.
      window.setTimeout(function () {
        window.dispatchEvent(new Event('resize'));
      }, 220);
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSidebarToggle);
  } else {
    wireSidebarToggle();
  }
})();
