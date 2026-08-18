import { randomUUID } from "crypto";
import { pool } from "./db.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
export const SESSION_COOKIE_NAME = "sid";

// 创建一个新 session，返回 session id（存进 cookie 的值）
export async function createSession(userId) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.execute(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    [sessionId, userId, expiresAt]
  );
  return { sessionId, expiresAt };
}

// 根据 session id 查用户信息（顺便校验是否过期）
export async function getUserBySessionId(sessionId) {
  if (!sessionId) return null;

  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.nickname
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > NOW()`,
    [sessionId]
  );

  return rows[0] || null;
}

export async function deleteSession(sessionId) {
  if (!sessionId) return;
  await pool.execute("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

// 简单的 cookie 解析（用于 WS 升级请求，那里没有 cookie-parser 中间件）
export function parseCookies(cookieHeader = "") {
  const result = {};
  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  });
  return result;
}
