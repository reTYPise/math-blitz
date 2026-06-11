'use strict';

const Auth = (() => {
  const COOKIE_NAME = 'math-blitz-user';
  const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
  const LOGIN_RE = /^[\p{L}\p{N}_-]{2,24}$/u;

  function cookiePath() {
    let base = window.APP_BASE_PATH || '/';
    if (!base.endsWith('/')) base += '/';
    return base;
  }

  function setLoginCookie(login) {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(login)}; path=${cookiePath()}; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  function getLoginFromCookie() {
    const prefix = `${COOKIE_NAME}=`;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return null;
  }

  function clearLoginCookie() {
    document.cookie = `${COOKIE_NAME}=; path=${cookiePath()}; max-age=0; SameSite=Lax`;
  }

  function normalizeLogin(raw) {
    return (raw || '').trim();
  }

  function isValidLogin(login) {
    return LOGIN_RE.test(login);
  }

  function showLogin() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.classList.add('show');
    const input = document.getElementById('auth-login');
    if (input) {
      requestAnimationFrame(() => input.focus());
    }
  }

  function hideLogin() {
    document.getElementById('auth-overlay')?.classList.remove('show');
    showError('');
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg || '';
  }

  return {
    setLoginCookie,
    getLoginFromCookie,
    clearLoginCookie,
    normalizeLogin,
    isValidLogin,
    showLogin,
    hideLogin,
    showError
  };
})();