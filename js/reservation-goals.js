(function () {
  const DATA_URL = 'data/amador-june-sheet-2026.json';
  let goals = [];
  function decorate() {
    const rows = Array.from(document.querySelectorAll('#campaigns-body tr:not(.reservations-total-row)'));
    rows.forEach((row, index) => {
      const cell = row.querySelector('.resultados-col');
      const goal = goals[index];
      if (!cell || goal == null || goal <= 0 || cell.querySelector('.reservation-trend')) return;
      const value = Number(cell.textContent.trim()) || 0;
      const reached = value >= goal;
      const indicator = document.createElement('span');
      indicator.className = `reservation-trend ${reached ? 'up' : 'down'}`;
      indicator.textContent = `${reached ? '▲' : '▼'} Objetivo: ${goal}`;
      indicator.title = `${reached ? 'Sobre el objetivo' : 'Debajo del objetivo'}: ${value}/${goal}`;
      indicator.setAttribute('aria-label', indicator.title);
      cell.appendChild(indicator);
    });
  }
  async function init() {
    if (!document.getElementById('reservation-goal-style')) {
      const style = document.createElement('style');
      style.id = 'reservation-goal-style';
      style.textContent = '.reservation-value{display:block}.reservation-trend{display:block;margin-top:3px;font-size:9px;font-weight:800;line-height:1.2;white-space:nowrap}.reservation-trend.up{color:#16a34a}.reservation-trend.down{color:#dc2626}';
      document.head.appendChild(style);
    }
    const data = window.AMADOR_JUNE_DATA || await fetch(DATA_URL, { cache: 'no-store' }).then(response => response.json());
    goals = data.campaigns.flatMap(campaign => (campaign.ads || []).map(ad => Number(ad.reservationGoal) || null));
    const body = document.getElementById('campaigns-body');
    if (!body) return;
    new MutationObserver(decorate).observe(body, { childList: true });
    decorate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
