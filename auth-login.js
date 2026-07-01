/**
 * auth-login.js — Pantalla de acceso reutilizable
 */
(function (global) {
  'use strict';
  const CSS = `
    #rb-auth-overlay{position:fixed;inset:0;z-index:9999;display:flex;width:100vw;height:100vh}
    #rb-auth-overlay.rb-auth-hidden{display:none}
    #rb-auth-panel{width:400px;flex-shrink:0;background:#fff;display:flex;align-items:center;justify-content:center;padding:48px 44px}
    #rb-auth-inner{width:100%}
    #rb-auth-brand{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#0284c7;margin-bottom:16px;font-family:inherit}
    #rb-auth-title{font-size:38px;font-weight:700;line-height:1.1;letter-spacing:-.02em;color:#0f172a;margin-bottom:28px;white-space:pre-line;font-family:inherit}
    #rb-auth-divider{width:40px;height:3px;background:#0284c7;border-radius:2px;margin-bottom:36px}
    #rb-auth-form{display:flex;flex-direction:column;gap:12px}
    #rb-auth-input{width:100%;padding:12px 16px;border-radius:8px;border:1.5px solid #e5e7eb;background:#f8fafc;color:#0f172a;font-size:14px;outline:none;transition:border-color .15s,background .15s;font-family:inherit;box-sizing:border-box}
    #rb-auth-input::placeholder{color:#94a3b8}#rb-auth-input:focus{border-color:#0284c7;background:#fff}
    #rb-auth-btn{width:100%;padding:12px;border-radius:8px;border:none;background:#0284c7;color:#fff;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:.02em;transition:background .15s;font-family:inherit}
    #rb-auth-btn:hover{background:#075985}
    #rb-auth-error{display:none;margin-top:12px;font-size:12px;color:#dc2626;font-family:inherit}
    #rb-auth-bg{flex:1;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;filter:grayscale(20%)}
  `;
  function loadReservationGoals() {
    if (document.querySelector('script[src="js/reservation-goals.js"]')) return;
    const script = document.createElement('script');
    script.src = 'js/reservation-goals.js';
    script.defer = true;
    document.head.appendChild(script);
  }
  function init(opts) {
    opts = opts || {};
    const PASSWORD = opts.password || 'RB2026';
    const BG_IMAGE = opts.bgImage || 'login-bg.jpg';
    const BRAND = opts.brand || 'Lima Retail';
    const TITLE = opts.title || 'Centro de\nControl';
    const SESSION_KEY = opts.sessionKey || 'rb_auth';
    loadReservationGoals();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const overlay = document.createElement('div');
    overlay.id = 'rb-auth-overlay';
    overlay.innerHTML = `<div id="rb-auth-panel"><div id="rb-auth-inner"><div id="rb-auth-brand">${BRAND}</div><div id="rb-auth-title">${TITLE}</div><div id="rb-auth-divider"></div><form id="rb-auth-form" autocomplete="off"><input id="rb-auth-input" type="password" placeholder="Contraseña" autocomplete="new-password" autofocus /><button type="submit" id="rb-auth-btn">Ingresar</button></form><div id="rb-auth-error">Contraseña incorrecta</div></div></div><div id="rb-auth-bg"></div>`;
    document.body.insertBefore(overlay, document.body.firstChild);
    document.getElementById('rb-auth-bg').style.backgroundImage = `url('${BG_IMAGE}')`;
    function unlock() {
      overlay.classList.add('rb-auth-hidden');
      sessionStorage.setItem(SESSION_KEY, '1');
    }
    if (sessionStorage.getItem(SESSION_KEY) === '1') { unlock(); return; }
    document.getElementById('rb-auth-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const input = document.getElementById('rb-auth-input');
      const error = document.getElementById('rb-auth-error');
      if (input.value === PASSWORD) { error.style.display = 'none'; unlock(); }
      else { input.value = ''; error.style.display = 'block'; input.focus(); }
    });
  }
  global.AuthLogin = { init };
})(window);
