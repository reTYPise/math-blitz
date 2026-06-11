'use strict';

const AppDB = (() => {
  const DB_STORAGE_KEY = 'math-blitz-sqlite-v1';
  const LEGACY_JSON_KEYS = ['math-blitz-stats-v1', 'math-blitz-v1'];
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_BASE_MS = 15 * 60 * 1000;
  const MAX_LOCKOUT_MS = 24 * 60 * 60 * 1000;

  let sqlModule = null;
  let db = null;
  let ready = false;
  let currentUser = null;

  function persist() {
    if (!db) return;
    const binary = db.export();
    const buffer = new Uint8Array(binary);
    let binaryStr = '';
    for (let i = 0; i < buffer.length; i++) binaryStr += String.fromCharCode(buffer[i]);
    localStorage.setItem(DB_STORAGE_KEY, btoa(binaryStr));
  }

  function loadFromStorage() {
    const saved = localStorage.getItem(DB_STORAGE_KEY);
    if (!saved) return null;
    const binaryStr = atob(saved);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
  }

  function migrateLegacyJson() {
    for (const key of LEGACY_JSON_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.sessions)) continue;
        parsed.sessions.forEach(s => {
          db.run(
            `INSERT INTO sessions (date, timestamp, trainer, game_mode, correct, wrong, answered, best_streak, elapsed_sec, range_max, input_mode, username)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.date || '',
              s.timestamp || Date.now(),
              s.trainer || s.ops?.join?.('+') || '×',
              s.gameMode || 'classic',
              s.correct || 0,
              s.wrong || 0,
              s.answered || 0,
              s.bestStreak || 0,
              s.elapsedSec || 0,
              s.rangeMax || 10,
              s.inputMode || 'choices',
              'guest'
            ]
          );
        });
        persist();
        localStorage.removeItem(key);
      } catch (e) {}
    }
  }

  function hasColumn(table, column) {
    const cols = queryAll(`PRAGMA table_info(${table})`);
    return cols.some(c => c.name === column);
  }

  function migrateUserSchema() {
    if (!hasColumn('sessions', 'username')) {
      db.run(`ALTER TABLE sessions ADD COLUMN username TEXT NOT NULL DEFAULT ''`);
      db.run(`UPDATE sessions SET username = 'guest' WHERE username = ''`);
      persist();
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        password_hash TEXT,
        session_token TEXT,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0
      )
    `);
    if (!hasColumn('users', 'password_hash')) {
      db.run(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
      persist();
    }
    if (!hasColumn('users', 'session_token')) {
      db.run(`ALTER TABLE users ADD COLUMN session_token TEXT`);
      persist();
    }
    if (!hasColumn('users', 'failed_attempts')) {
      db.run(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`);
      persist();
    }
    if (!hasColumn('users', 'locked_until')) {
      db.run(`ALTER TABLE users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0`);
      persist();
    }
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(username, date)`);
  }

  function initSchema() {
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        trainer TEXT NOT NULL,
        game_mode TEXT NOT NULL,
        correct INTEGER NOT NULL DEFAULT 0,
        wrong INTEGER NOT NULL DEFAULT 0,
        answered INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        elapsed_sec REAL NOT NULL DEFAULT 0,
        range_max INTEGER NOT NULL DEFAULT 10,
        input_mode TEXT NOT NULL DEFAULT 'choices',
        username TEXT NOT NULL DEFAULT ''
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_trainer ON sessions(trainer)`);
    migrateUserSchema();
  }

  function setCurrentUser(username) {
    currentUser = username || null;
  }

  function getCurrentUser() {
    return currentUser;
  }

  function requireUser() {
    if (!currentUser) throw new Error('User not logged in');
  }

  function issueSession(username) {
    const token = Auth.generateSessionToken();
    db.run(`UPDATE users SET session_token = ? WHERE username = ?`, [token, username]);
    persist();
    return token;
  }

  function resetLoginSecurity(username) {
    db.run(
      `UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE username = ?`,
      [username]
    );
    persist();
  }

  function recordFailedLogin(username) {
    const row = queryOne(
      `SELECT failed_attempts FROM users WHERE username = ?`,
      [username]
    );
    const attempts = (row?.failed_attempts || 0) + 1;
    let lockedUntil = 0;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const exponent = Math.min(attempts - MAX_FAILED_ATTEMPTS, 5);
      const duration = Math.min(LOCKOUT_BASE_MS * Math.pow(2, exponent), MAX_LOCKOUT_MS);
      lockedUntil = Date.now() + duration;
    }
    db.run(
      `UPDATE users SET failed_attempts = ?, locked_until = ? WHERE username = ?`,
      [attempts, lockedUntil, username]
    );
    persist();
    return { attempts, lockedUntil };
  }

  async function loginWithPassword(username, password) {
    const global = Auth.checkGlobalRateLimit();
    if (global.blocked) {
      return { ok: false, error: `Слишком много попыток. Подождите ${global.retryAfterSec} сек.` };
    }
    Auth.recordGlobalAttempt();

    const existing = queryOne(
      `SELECT username, password_hash, failed_attempts, locked_until FROM users WHERE username = ?`,
      [username]
    );

    if (existing) {
      const lock = Auth.getLockoutStatus(existing.locked_until);
      if (lock.locked) {
        return { ok: false, error: `Аккаунт временно заблокирован. Подождите ${lock.minutes} мин.` };
      }
    }

    if (!existing) {
      const hash = await Auth.hashPasswordForStorage(password);
      const token = Auth.generateSessionToken();
      db.run(
        `INSERT INTO users (username, created_at, password_hash, session_token, failed_attempts, locked_until)
         VALUES (?, ?, ?, ?, 0, 0)`,
        [username, Date.now(), hash, token]
      );
      persist();
      currentUser = username;
      return { ok: true, token, isNew: true };
    }

    const verified = await Auth.verifyPassword(password, existing.password_hash);
    if (!verified.ok) {
      if (existing.password_hash) {
        const fail = recordFailedLogin(username);
        await Auth.enforceLoginDelay(fail.attempts);
        const lock = Auth.getLockoutStatus(fail.lockedUntil);
        if (lock.locked) {
          return { ok: false, error: `Слишком много попыток. Аккаунт заблокирован на ${lock.minutes} мин.` };
        }
      }
      return { ok: false, error: 'Неверный пароль' };
    }

    const token = issueSession(username);
    if (verified.hash) {
      db.run(`UPDATE users SET password_hash = ? WHERE username = ?`, [verified.hash, username]);
      persist();
    }
    resetLoginSecurity(username);
    currentUser = username;
    return { ok: true, token, isNew: false, migrated: !!verified.needsSet };
  }

  function restoreSession(username, token) {
    if (!Auth.canRestoreSession(username, token)) return false;
    const row = queryOne(
      `SELECT session_token FROM users WHERE username = ?`,
      [username]
    );
    if (!row?.session_token || !Auth.timingSafeEqual(row.session_token, token)) return false;
    currentUser = username;
    return true;
  }

  function logout() {
    if (currentUser) {
      db.run(`UPDATE users SET session_token = NULL WHERE username = ?`, [currentUser]);
      persist();
    }
    currentUser = null;
  }

  function assetPath(relativePath) {
    const base = window.APP_BASE_PATH || '/';
    return `${base}${relativePath}`.replace(/\/{2,}/g, '/');
  }

  async function init() {
    if (ready) return;
    sqlModule = await initSqlJs({ locateFile: file => assetPath(`js/vendor/${file}`) });
    const saved = loadFromStorage();
    db = saved ? new sqlModule.Database(saved) : new sqlModule.Database();
    initSchema();
    migrateLegacyJson();
    ready = true;
  }

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function recordSession(session) {
    requireUser();
    db.run(
      `INSERT INTO sessions (date, timestamp, trainer, game_mode, correct, wrong, answered, best_streak, elapsed_sec, range_max, input_mode, username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.date,
        session.timestamp || Date.now(),
        session.trainer,
        session.gameMode,
        session.correct,
        session.wrong,
        session.answered,
        session.bestStreak,
        session.elapsedSec,
        session.rangeMax || 10,
        session.inputMode || 'choices',
        currentUser
      ]
    );
    persist();
  }

  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows[0] || null;
  }

  function getPracticeDates() {
    requireUser();
    return queryAll(
      `SELECT DISTINCT date FROM sessions WHERE username = ? AND date != '' ORDER BY date DESC`,
      [currentUser]
    ).map(r => r.date);
  }

  function calculateDailyStreak(referenceDate = new Date()) {
    const dates = new Set(getPracticeDates());
    if (dates.size === 0) return 0;
    const cursor = new Date(referenceDate);
    cursor.setHours(0, 0, 0, 0);
    if (!dates.has(formatDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (dates.has(formatDateKey(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function hasSessionToday(date = new Date()) {
    requireUser();
    const key = formatDateKey(date);
    const row = queryOne(
      `SELECT COUNT(*) AS c FROM sessions WHERE username = ? AND date = ?`,
      [currentUser, key]
    );
    return (row?.c || 0) > 0;
  }

  function getOverallStats(date = new Date()) {
    requireUser();
    const totals = queryOne(`
      SELECT
        COUNT(*) AS total_sessions,
        COALESCE(SUM(correct), 0) AS total_correct,
        COALESCE(SUM(answered), 0) AS total_answered,
        COALESCE(MAX(best_streak), 0) AS max_streak
      FROM sessions
      WHERE username = ?
    `, [currentUser]);
    const todayKey = formatDateKey(date);
    const todayRow = queryOne(
      `SELECT COUNT(*) AS c FROM sessions WHERE username = ? AND date = ?`,
      [currentUser, todayKey]
    );
    const totalAnswered = totals?.total_answered || 0;
    const totalCorrect = totals?.total_correct || 0;
    return {
      totalSessions: totals?.total_sessions || 0,
      totalCorrect,
      totalAnswered,
      accuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
      bestStreak: totals?.max_streak || 0,
      dailyStreak: calculateDailyStreak(date),
      todayCount: todayRow?.c || 0
    };
  }

  function getTrainerBreakdown() {
    requireUser();
    return queryAll(`
      SELECT
        trainer,
        COUNT(*) AS sessions,
        COALESCE(SUM(correct), 0) AS correct,
        COALESCE(SUM(answered), 0) AS answered
      FROM sessions
      WHERE username = ?
      GROUP BY trainer
      ORDER BY sessions DESC
    `, [currentUser]).map(row => ({
      trainer: row.trainer,
      sessions: row.sessions,
      accuracy: row.answered > 0 ? Math.round((row.correct / row.answered) * 100) : 0
    }));
  }

  function getRecentSessions(limit = 6) {
    requireUser();
    return queryAll(`
      SELECT date, trainer, game_mode, correct, wrong, answered, best_streak, elapsed_sec, timestamp, range_max
      FROM sessions
      WHERE username = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [currentUser, limit]);
  }

  function getWeeklyActivity(date = new Date()) {
    requireUser();
    const days = [];
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() - i);
      const key = formatDateKey(d);
      const row = queryOne(
        `SELECT COUNT(*) AS c FROM sessions WHERE username = ? AND date = ?`,
        [currentUser, key]
      );
      days.push({ date: key, count: row?.c || 0, weekday: d.getDay() });
    }
    return days;
  }

  return {
    init,
    formatDateKey,
    setCurrentUser,
    getCurrentUser,
    loginWithPassword,
    restoreSession,
    logout,
    recordSession,
    calculateDailyStreak,
    hasSessionToday,
    getOverallStats,
    getTrainerBreakdown,
    getRecentSessions,
    getWeeklyActivity
  };
})();