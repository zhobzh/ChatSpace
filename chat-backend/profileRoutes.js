import { Router, raw } from "express";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { getUserBySessionId, SESSION_COOKIE_NAME } from "./sessionUtils.js";
import { realtimeEvents } from "./realtimeEvents.js";

const router = Router();
const avatarDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "uploads", "avatars");
const avatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
await mkdir(avatarDir, { recursive: true });

router.use(async (req, res, next) => {
  const user = await getUserBySessionId(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: "未登录" });
  req.user = user;
  next();
});

function publicProfile(row, isSelf = false) {
  return {
    userId: row.id,
    nickname: row.nickname,
    fullName: row.full_name || "",
    bio: row.bio || "",
    preferredStatus: row.presence_status || "online",
    status: row.presence_status || "online",
    lastSeenAt: row.last_seen_at,
    avatarVersion: row.avatar_key ? new Date(row.updated_at || Date.now()).getTime() : null,
    ...(isSelf ? { email: row.email } : {}),
  };
}

async function findProfile(userId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.nickname, p.full_name, p.bio, p.avatar_key,
            p.presence_status, p.last_seen_at, p.updated_at
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    [userId]
  );
  return rows[0];
}

router.get("/me", async (req, res) => {
  const row = await findProfile(req.user.id);
  res.json(publicProfile(row, true));
});

router.get("/:userId", async (req, res) => {
  const row = await findProfile(req.params.userId);
  if (!row) return res.status(404).json({ error: "用户不存在" });
  res.json(publicProfile(row, req.params.userId === req.user.id));
});

router.patch("/me", async (req, res) => {
  const nickname = typeof req.body.nickname === "string" ? req.body.nickname.trim() : "";
  const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
  const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
  if (!nickname || nickname.length > 100) return res.status(400).json({ error: "昵称需要为 1–100 个字符" });
  if (fullName.length > 100) return res.status(400).json({ error: "姓名不能超过 100 个字符" });
  if (bio.length > 160) return res.status(400).json({ error: "个性签名不能超过 160 个字符" });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET nickname = ? WHERE id = ?", [nickname, req.user.id]);
    await connection.execute(
      `INSERT INTO user_profiles (user_id, full_name, bio) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), bio = VALUES(bio)`,
      [req.user.id, fullName || null, bio || null]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const profile = publicProfile(await findProfile(req.user.id), true);
  realtimeEvents.emit("profile-updated", profile);
  res.json(profile);
});

router.post("/me/avatar", raw({ type: () => true, limit: "5mb" }), async (req, res) => {
  const mimeType = (req.header("content-type") || "").split(";")[0].toLowerCase();
  if (!avatarTypes.has(mimeType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(415).json({ error: "头像仅支持 JPEG、PNG 或 WebP" });
  }
  const valid = mimeType === "image/jpeg" ? req.body[0] === 0xff && req.body[1] === 0xd8
    : mimeType === "image/png" ? req.body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      : req.body.subarray(0, 4).toString() === "RIFF" && req.body.subarray(8, 12).toString() === "WEBP";
  if (!valid) return res.status(415).json({ error: "头像文件内容无效" });

  const old = await findProfile(req.user.id);
  const avatarKey = randomUUID();
  await writeFile(path.join(avatarDir, avatarKey), req.body, { flag: "wx" });
  await pool.execute(
    `INSERT INTO user_profiles (user_id, avatar_key, avatar_mime) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE avatar_key = VALUES(avatar_key), avatar_mime = VALUES(avatar_mime)`,
    [req.user.id, avatarKey, mimeType]
  );
  if (old?.avatar_key) await unlink(path.join(avatarDir, old.avatar_key)).catch(() => {});
  const profile = publicProfile(await findProfile(req.user.id), true);
  realtimeEvents.emit("profile-updated", profile);
  res.json(profile);
});

router.get("/:userId/avatar", async (req, res) => {
  const [rows] = await pool.execute("SELECT avatar_key, avatar_mime FROM user_profiles WHERE user_id = ?", [req.params.userId]);
  if (!rows[0]?.avatar_key) return res.status(404).end();
  try {
    const content = await readFile(path.join(avatarDir, rows[0].avatar_key));
    res.set("Content-Type", rows[0].avatar_mime);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(content);
  } catch { res.status(404).end(); }
});

export default router;
