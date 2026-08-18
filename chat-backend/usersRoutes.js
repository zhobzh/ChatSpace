import { Router } from "express";
import { pool } from "./db.js";
import { getUserBySessionId, SESSION_COOKIE_NAME } from "./sessionUtils.js";

const router = Router();

router.use(async (req, res, next) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  const user = await getUserBySessionId(sessionId);
  if (!user) return res.status(401).json({ error: "未登录" });
  req.user = user;
  next();
});

// 所有注册用户（不含自己），用于"点击某人发起私聊"这个列表
router.get("/", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.nickname, p.full_name, p.bio, p.avatar_key, p.updated_at
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id != ? ORDER BY u.nickname ASC`,
    [req.user.id]
  );
  res.json(rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    fullName: row.full_name || "",
    bio: row.bio || "",
    avatarVersion: row.avatar_key ? new Date(row.updated_at || Date.now()).getTime() : null,
  })));
});

export default router;
