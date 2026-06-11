'use strict';

const Auth = (() => {
  const USER_COOKIE = 'math-blitz-user';
  const SESSION_COOKIE = 'math-blitz-session';
  const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
  const GLOBAL_RATE_KEY = 'math-blitz-auth-global';
  const LOGIN_RE = /^[\p{L}\p{N}_-]{2,24}$/u;
  const SESSION_TOKEN_RE = /^[0-9a-f]{48}$/;
  const PASSWORD_MIN = 4;
  const PASSWORD_MAX = 64;
  const PBKDF2_ITERATIONS = 310000;
  const GLOBAL_WINDOW_MS = 10 * 60 * 1000;
  const GLOBAL_MAX_ATTEMPTS = 30;

  function cookiePath() {
    let base = window.APP_BASE_PATH || '/';
    if (!base.endsWith('/')) base += '/';
    return base;
  }

  function cookieFlags() {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    return `; path=${cookiePath()}; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  }

  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}${cookieFlags()}`;
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
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=; path=${cookiePath()}; max-age=0; SameSite=Lax${secure}`;
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

  function bufToHex(buf) {
    return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToBuf(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const len = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let i = 0; i < len; i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  async function legacySha256(password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return bufToHex(new Uint8Array(buf));
  }

  async function derivePbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      256
    );
    return bufToHex(new Uint8Array(bits));
  }

  async function hashPasswordForStorage(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hashHex = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2:${PBKDF2_ITERATIONS}:${bufToHex(salt)}:${hashHex}`;
  }

  async function verifyPassword(password, stored) {
    if (!stored) {
      const hash = await hashPasswordForStorage(password);
      return { ok: true, needsSet: true, hash };
    }

    if (stored.startsWith('pbkdf2:')) {
      const parts = stored.split(':');
      if (parts.length !== 4) return { ok: false };
      const iterations = parseInt(parts[1], 10);
      const salt = hexToBuf(parts[2]);
      const expected = parts[3];
      if (!iterations || !expected) return { ok: false };
      const actual = await derivePbkdf2(password, salt, iterations);
      if (!timingSafeEqual(actual, expected)) return { ok: false };
      if (iterations < PBKDF2_ITERATIONS) {
        const hash = await hashPasswordForStorage(password);
        return { ok: true, upgrade: true, hash };
      }
      return { ok: true };
    }

    if (/^[0-9a-f]{64}$/.test(stored)) {
      const legacy = await legacySha256(password);
      if (!timingSafeEqual(legacy, stored)) return { ok: false };
      const hash = await hashPasswordForStorage(password);
      return { ok: true, upgrade: true, hash };
    }

    return { ok: false };
  }

  function generateSessionToken() {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return bufToHex(arr);
  }

  function isValidSessionToken(token) {
    return typeof token === 'string' && SESSION_TOKEN_RE.test(token);
  }

  function getLockoutStatus(lockedUntil) {
    const until = Number(lockedUntil) || 0;
    const now = Date.now();
    if (until > now) {
      const sec = Math.ceil((until - now) / 1000);
      return { locked: true, seconds: sec, minutes: Math.max(1, Math.ceil(sec / 60)) };
    }
    return { locked: false };
  }

  function checkGlobalRateLimit() {
    try {
      const now = Date.now();
      const raw = sessionStorage.getItem(GLOBAL_RATE_KEY);
      let data = raw ? JSON.parse(raw) : { count: 0, windowStart: now };
      if (now - data.windowStart > GLOBAL_WINDOW_MS) {
        data = { count: 0, windowStart: now };
      }
      if (data.count >= GLOBAL_MAX_ATTEMPTS) {
        return {
          blocked: true,
          retryAfterSec: Math.max(1, Math.ceil((data.windowStart + GLOBAL_WINDOW_MS - now) / 1000))
        };
      }
      return { blocked: false, data };
    } catch (e) {
      return { blocked: false, data: { count: 0, windowStart: Date.now() } };
    }
  }

  function recordGlobalAttempt() {
    try {
      const check = checkGlobalRateLimit();
      const data = check.data || { count: 0, windowStart: Date.now() };
      data.count += 1;
      sessionStorage.setItem(GLOBAL_RATE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  async function enforceLoginDelay(failedAttempts) {
    const ms = Math.min(500 * Math.pow(2, Math.min(Math.max(failedAttempts, 1), 6)), 8000);
    await new Promise(resolve => setTimeout(resolve, ms));
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

  function canRestoreSession(login, token) {
    const normalized = normalizeLogin(login);
    return isValidLogin(normalized) && isValidSessionToken(token);
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

  function setSubmitEnabled(enabled) {
    const btn = document.querySelector('.auth-submit');
    if (btn) btn.disabled = !enabled;
  }

  return {
    setLoginCookie,
    setSessionCookie,
    getLoginFromCookie,
    getSessionFromCookie,
    clearAllCookies,
    hashPasswordForStorage,
    verifyPassword,
    generateSessionToken,
    timingSafeEqual,
    getLockoutStatus,
    checkGlobalRateLimit,
    recordGlobalAttempt,
    enforceLoginDelay,
    normalizeLogin,
    isValidLogin,
    isValidPassword,
    isValidSessionToken,
    canRestoreSession,
    showLogin,
    hideLogin,
    showError,
    clearAuthForm,
    setSubmitEnabled
  };
})();