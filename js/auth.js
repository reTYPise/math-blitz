'use strict';

const Auth = (() => {
  const USER_COOKIE = 'math-blitz-user';
  const SESSION_COOKIE = 'math-blitz-session';
  const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
  const LOGIN_RE = /^[\p{L}\p{N}_-]{2,24}$/u;
  const PASSWORD_MIN = 4;
  const PASSWORD_MAX = 64;

  function cookiePath() {
    let base = window.APP_BASE_PATH || '/';
    if (!base.endsWith('/')) base += '/';
    return base;
  }

  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=${cookiePath()}; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  function getCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return null;
  }

  function clearCookie(name) {
    document.cookie = `${name}=; path=${cookiePath()}; max-age=0; SameSite=Lax`;
  }

  function setLoginCookie(login) {
    setCookie(USER_COOKIE, login);
  }

  function setSessionCookie(token) {
    setCookie(SESSION_COOKIE, token);
  }

  function getLoginFromCookie() {
    return getCookie(USER_COOKIE);
  }

  function getSessionFromCookie() {
    return getCookie(SESSION_COOKIE);
  }

  function clearAllCookies() {
    clearCookie(USER_COOKIE);
    clearCookie(SESSION_COOKIE);
  }

  async function hashPassword(password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateSessionToken() {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeLogin(raw) {
    return (raw || '').trim();
  }

  function isValidLogin(login) {
    return LOGIN_RE.test(login);
  }

  function isValidPassword(password) {
    return typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
  }

  function showLogin() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.classList.add('show');
    const input = document.getElementById('auth-login');
    if (input) requestAnimationFrame(() => input.focus());
  }

  function hideLogin() {
    document.getElementById('auth-overlay')?.classList.remove('show');
    showError('');
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) el.textContent = msg || '';
  }

  function clearAuthForm() {
    const login = document.getElementById('auth-login');
    const password = document.getElementById('auth-password');
    if (login) login.value = '';
    if (password) password.value = '';
  }

  return {
    setLoginCookie,
    setSessionCookie,
    getLoginFromCookie,
    getSessionFromCookie,
    clearAllCookies,
    hashPassword,
    generateSessionToken,
    normalizeLogin,
    isValidLogin,
    isValidPassword,
    showLogin,
    hideLogin,
    showError,
    clearAuthForm
  };
})();