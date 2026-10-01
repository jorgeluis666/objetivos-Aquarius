(function () {
  // Directorio de quien tiene la clave del tablero. En GitHub Pages el acceso es una sola clave compartida (el
  // secret AQ_PAGE_PASSWORD, ver README): no hay usuarios de acceso y la clave nunca pasa por aqui. La lista
  // registra a quien se le entrego y, con la fecha del ultimo cambio de clave, avisa si alguien suspendido
  // todavia la conoce. Lo publicado es data/aquarius-usuarios-2026.json, cifrado porque el repo es publico: el build
  // lo descifra (scripts/usuarios-cifrado.js) y lo incrusta como window.AQUARIUS_USUARIOS. Las ediciones quedan
  // como borrador en este navegador hasta exportarlas, y Exportar ya entrega el archivo cifrado.
  const DATA_URL = 'data/aquarius-usuarios-2026.json';
  const DRAFT_KEY = 'aquarius-usuarios-draft';
  const EXPORT_NAME = 'aquarius-usuarios-2026.json';
  const INLINE_GLOBAL = 'AQUARIUS_USUARIOS';
  const PUBLIC_KEY_GLOBAL = 'AQUARIUS_USUARIOS_PUBLIC_KEY';
  const ENCRYPTION = 'RSA-OAEP-SHA256/AES-256-GCM';
  const ROLES = { cliente: 'Cliente', equipo: 'Equipo Lima Retail', admin: 'Administrador' };
  const STATUSES = { activo: 'Activo', suspendido: 'Suspendido' };
  // Sin poder leer el directorio no se edita: exportar reemplazaria el archivo publicado por uno vacio.
  const LOCKED = {
    'sin-llave': 'Este build no tiene la llave privada del directorio: falta el secret AQ_USERS_PRIVATE_KEY en GitHub (o credentials/aquarius-usuarios-privada.pem en local).',
    'llave-invalida': 'La llave privada configurada no abre el directorio: revisa el secret AQ_USERS_PRIVATE_KEY.',
    'sin-build': 'La versión sin compilar no tiene la llave para leerlo: ábrelo desde el tablero publicado o desde un build local (npm run build).',
  };

  const state = { ready: false, published: {}, locked: '', users: [], keyChangedAt: '', draft: false, status: 'all' };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const pad = value => String(value).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const fmtDate = value => (validDate(value) ? value.split('-').reverse().join('/') : '');
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const plural = (count, one, many) => (count === 1 ? one : many);

  function clean(user) {
    const status = STATUSES[user?.status] ? user.status : 'activo';
    return {
      id: String(user?.id || newId()),
      name: String(user?.name || '').trim(),
      role: ROLES[user?.role] ? user.role : 'cliente',
      status,
      since: validDate(user?.since) ? user.since : today(),
      // Fecha de baja: solo la lleva quien esta suspendido. Sin ella no se sabe si fue antes o despues del
      // ultimo cambio de clave, asi que cuenta como pendiente.
      until: status === 'suspendido' && validDate(user?.until) ? user.until : '',
    };
  }

  function fromSource(source) {
    return {
      users: (Array.isArray(source?.users) ? source.users : []).map(clean),
      keyChangedAt: validDate(source?.keyChangedAt) ? source.keyChangedAt : '',
    };
  }

  function readDraft() {
    try {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
      // Un borrador hecho sobre una version anterior del archivo ya no aplica: se ignora.
      return draft && draft.base === state.published.updatedAt && Array.isArray(draft.users) ? fromSource(draft) : null;
    } catch {
      return null;
    }
  }

  function saveDraft() {
    state.draft = true;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: state.published.updatedAt, keyChangedAt: state.keyChangedAt, users: state.users }));
    } catch {
      // Sin localStorage los cambios duran hasta recargar; Exportar sigue funcionando.
    }
  }

  function discardDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* sin localStorage no hay borrador guardado */ }
    Object.assign(state, fromSource(state.published), { draft: false });
    render();
  }

  const bytes = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const toBase64 = buffer => btoa(Array.from(new Uint8Array(buffer), byte => String.fromCharCode(byte)).join(''));

  // Mismo esquema que scripts/usuarios-cifrado.js: una llave AES-GCM al azar cifra el JSON y la llave publica
  // RSA-OAEP la envuelve. Solo la privada, que no esta en el tablero, puede abrirlo.
  async function encrypt(directory) {
    const publicKey = await crypto.subtle.importKey('spki', bytes(window[PUBLIC_KEY_GLOBAL]), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(JSON.stringify(directory)));
    const key = await crypto.subtle.wrapKey('raw', aesKey, publicKey, { name: 'RSA-OAEP' });
    return { encryption: ENCRYPTION, key: toBase64(key), iv: toBase64(iv), data: toBase64(data) };
  }

  async function exportJson() {
    if (!window[PUBLIC_KEY_GLOBAL] || !window.crypto?.subtle) {
      window.alert('Este tablero no puede cifrar el archivo: exporta desde el tablero publicado.');
      return;
    }
    let payload;
    try {
      payload = {
        // Con hora: un borrador nuevo del mismo dia no se confunde con el archivo ya publicado.
        updatedAt: new Date().toISOString(),
        ...(await encrypt({ keyChangedAt: state.keyChangedAt, users: state.users.filter(user => user.name).sort(byName) })),
      };
    } catch (error) {
      console.error('[usuarios] no se pudo cifrar el archivo', error);
      window.alert('No se pudo cifrar el archivo. No se descargó nada.');
      return;
    }
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = EXPORT_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // Quien fue suspendido despues del ultimo cambio de clave todavia la conoce.
  const pendingRotation = () => state.users.filter(user => user.status === 'suspendido'
    && (!state.keyChangedAt || !user.until || user.until > state.keyChangedAt));

  function options(map, selected) {
    return Object.entries(map).map(([value, text]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${text}</option>`).join('');
  }

  function renderUser(user) {
    const suspended = user.status === 'suspendido';
    const until = suspended
      ? `<input class="users-field" type="date" data-field="until" value="${esc(user.until)}" aria-label="Fecha de baja" title="Fecha de baja">`
      : '<span class="users-empty" aria-hidden="true">-</span>';
    return `<li class="users-item${suspended ? ' suspended' : ''}" data-id="${esc(user.id)}">
      <input class="users-field users-name" type="text" data-field="name" value="${esc(user.name)}" placeholder="Nombre" aria-label="Nombre">
      <select class="users-field users-role ${esc(user.role)}" data-field="role" aria-label="Rol">${options(ROLES, user.role)}</select>
      <input class="users-field" type="date" data-field="since" value="${esc(user.since)}" aria-label="Fecha de alta" title="Fecha de alta">
      <select class="users-field users-state ${esc(user.status)}" data-field="status" aria-label="Estado">${options(STATUSES, user.status)}</select>
      ${until}
      <button class="users-delete" type="button" data-action="delete" aria-label="Eliminar" title="Eliminar">&times;</button>
    </li>`;
  }

  function renderSummary(pending) {
    const host = document.getElementById('users-kpis');
    if (!host) return;
    const active = state.users.filter(user => user.status === 'activo').length;
    const suspended = state.users.length - active;
    const age = state.keyChangedAt ? Math.round((Date.parse(today()) - Date.parse(state.keyChangedAt)) / 86400000) : null;
    const cards = [
      ['Con acceso', active, `De ${state.users.length} en el directorio`],
      ['Suspendidos', suspended, pending.length ? `${pending.length} ${plural(pending.length, 'todavía conoce', 'todavía conocen')} la clave` : 'Ninguno conoce la clave vigente'],
      ['Último cambio de clave', fmtDate(state.keyChangedAt) || 'Sin registrar', age === null ? 'Regístralo en el directorio' : age <= 0 ? 'Hoy' : `Hace ${age} ${plural(age, 'día', 'días')}`],
    ];
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }

  function renderAlert(pending) {
    const box = document.getElementById('users-alert');
    if (!box) return;
    if (pending.length) {
      const names = esc(pending.map(user => user.name || 'Sin nombre').join(', '));
      const knows = plural(pending.length, 'la conoce', 'la conocen');
      box.classList.add('error');
      box.innerHTML = state.keyChangedAt
        ? `<strong>Cambia la clave del tablero</strong>La clave no cambia desde el ${fmtDate(state.keyChangedAt)} y después se suspendió a ${names}, que todavía ${knows}.`
        : `<strong>Cambia la clave del tablero</strong>No hay un cambio de clave registrado después de suspender a ${names}, que todavía ${knows}.`;
    } else {
      box.classList.remove('error');
      box.innerHTML = '<strong>Registra el último cambio de clave</strong>Con esa fecha el módulo avisa si alguien suspendido todavía conoce la clave vigente.';
    }
    box.hidden = !pending.length && Boolean(state.keyChangedAt);
  }

  function renderStatus() {
    const status = document.getElementById('users-status');
    if (status) {
      const published = String(state.published.updatedAt || '').slice(0, 10);
      status.textContent = state.draft
        ? 'Borrador en este navegador: exporta el archivo para publicarlo.'
        : `Publicado al ${fmtDate(published) || '-'}.`;
      status.classList.toggle('draft', state.draft);
    }
    const discard = document.getElementById('users-discard');
    if (discard) discard.hidden = !state.draft;
    const keyDate = document.getElementById('users-key-date');
    if (keyDate) {
      keyDate.value = state.keyChangedAt;
      keyDate.max = today();
    }
  }

  function renderLocked() {
    const box = document.getElementById('users-alert');
    if (box) {
      box.classList.add('error');
      box.innerHTML = `<strong>Directorio cifrado</strong>${esc(LOCKED[state.locked] || 'No se pudo leer el directorio.')} Mientras tanto no se puede editar, para no reemplazar el archivo publicado por uno vacío.`;
      box.hidden = false;
    }
    const kpis = document.getElementById('users-kpis');
    if (kpis) kpis.innerHTML = '';
  }

  function render() {
    const list = document.getElementById('users-list');
    if (!list) return;
    const panel = document.getElementById('users-panel');
    if (panel) panel.hidden = Boolean(state.locked);
    if (state.locked) { renderLocked(); return; }
    const visible = state.users
      .filter(user => state.status === 'all' || user.status === state.status)
      .sort(byName);
    list.innerHTML = visible.length
      ? `<div class="users-head" aria-hidden="true"><span>Nombre</span><span>Rol</span><span>Alta</span><span>Estado</span><span>Baja</span><span></span></div>
        <ul class="users-items">${visible.map(renderUser).join('')}</ul>`
      : `<div class="users-none">${state.users.length ? 'No hay usuarios con este filtro.' : 'Todavía no hay usuarios registrados.'}</div>`;
    const pending = pendingRotation();
    renderSummary(pending);
    renderAlert(pending);
    renderStatus();
  }

  function updateUser(target) {
    const row = target.closest('.users-item');
    const user = row && state.users.find(entry => entry.id === row.dataset.id);
    if (!user) return;
    const field = target.dataset.field;
    if (field === 'name') user.name = target.value.trim();
    else if (field === 'role') user.role = target.value;
    else if (field === 'status') {
      user.status = target.value;
      // Suspender marca la baja hoy; reactivar la borra.
      user.until = user.status === 'suspendido' ? today() : '';
    } else if (field === 'since' || field === 'until') {
      // Una fecha borrada vuelve a mostrar la que tenia.
      if (!validDate(target.value)) { render(); return; }
      user[field] = target.value;
    } else return;
    saveDraft();
    render();
  }

  function wireEvents() {
    const form = document.getElementById('users-form');
    form?.addEventListener('submit', event => {
      event.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) { form.elements.name.focus(); return; }
      const repeated = state.users.some(user => user.name.localeCompare(name, 'es', { sensitivity: 'base' }) === 0);
      if (repeated && !window.confirm(`"${name}" ya está en la lista. ¿Agregar de todas formas?`)) return;
      state.users.push(clean({ name, role: form.elements.role.value }));
      form.reset();
      saveDraft();
      render();
      form.elements.name.focus();
    });
    const list = document.getElementById('users-list');
    // Se guarda al terminar de editar (change), asi redibujar no quita el foco mientras se escribe.
    list?.addEventListener('change', event => updateUser(event.target));
    list?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('.users-name')) { event.preventDefault(); event.target.blur(); }
    });
    list?.addEventListener('click', event => {
      const button = event.target.closest('[data-action="delete"]');
      if (!button) return;
      const id = button.closest('.users-item')?.dataset.id;
      const user = state.users.find(entry => entry.id === id);
      if (!user) return;
      // Borrar a alguien activo no le quita la clave: para eso se suspende.
      const note = user.status === 'activo' ? '\n\nOjo: quitarlo de la lista no le quita la clave. Para eso, márcalo como Suspendido y cambia la clave.' : '';
      if (window.confirm(`¿Quitar a "${user.name || 'Sin nombre'}" del directorio?${note}`)) {
        state.users = state.users.filter(entry => entry.id !== id);
        saveDraft();
        render();
      }
    });
    document.getElementById('users-filter')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.status = input.value;
      document.querySelectorAll('#users-filter [data-series]').forEach(pill => pill.classList.toggle('active', pill.dataset.series === state.status));
      render();
    });
    document.getElementById('users-key-date')?.addEventListener('change', event => {
      const value = event.target.value;
      if (value && !validDate(value)) { render(); return; }
      state.keyChangedAt = value;
      saveDraft();
      render();
    });
    document.getElementById('users-export')?.addEventListener('click', exportJson);
    document.getElementById('users-discard')?.addEventListener('click', () => {
      if (window.confirm('¿Descartar los cambios del borrador y volver a lo publicado?')) discardDraft();
    });
  }

  async function loadPublished() {
    const inline = window[INLINE_GLOBAL];
    if (inline && typeof inline === 'object') return inline;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      // Sin build el archivo llega cifrado y aqui no hay llave para abrirlo.
      if (data?.encryption) return { updatedAt: data.updatedAt, locked: 'sin-build' };
      return data && typeof data === 'object' ? data : {};
    } catch (error) {
      console.warn('[usuarios] no se pudo leer', DATA_URL, error);
      return { locked: 'sin-build' };
    }
  }

  // Idempotente: la navegacion la llama cada vez que se abre la vista.
  async function init() {
    if (state.ready) return;
    state.ready = true;
    wireEvents();
    state.published = await loadPublished();
    state.locked = state.published.locked ? String(state.published.locked) : '';
    // Lo agregado mientras cargaba el archivo se suma a lo cargado en vez de perderse.
    const early = state.users;
    const draft = readDraft();
    state.draft = Boolean(draft);
    Object.assign(state, draft || fromSource(state.published));
    state.users = state.users.concat(early);
    if (early.length) saveDraft();
    render();
  }

  window.AquariusUsuarios = { init, render };
})();
