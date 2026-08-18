import { Router } from "express";
import { randomUUID } from "crypto";
import { pool } from "./db.js";
import { getUserBySessionId, SESSION_COOKIE_NAME } from "./sessionUtils.js";
import { realtimeEvents } from "./realtimeEvents.js";

const router = Router();
export const DEFAULT_CHANNEL_ID = "00000000-0000-0000-0000-000000000001";

async function requireAuth(req, res, next) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  const user = await getUserBySessionId(sessionId);
  if (!user) return res.status(401).json({ error: "未登录" });
  req.user = user;
  next();
}
router.use(requireAuth);

router.post("/dm", async (req, res) => {
  const { targetUserId } = req.body || {};

  if (typeof targetUserId !== "string" || targetUserId === req.user.id) {
    return res.status(400).json({ error: "目标用户不合法" });
  }

  const [targetRows] = await pool.execute(
    "SELECT id, nickname FROM users WHERE id = ?",
    [targetUserId]
  );
  const targetUser = targetRows[0];
  if (!targetUser) return res.status(404).json({ error: "用户不存在" });

  const dmKey = [req.user.id, targetUserId].sort().join(":");

  const [existing] = await pool.execute(
    "SELECT id FROM channels WHERE dm_key = ?",
    [dmKey]
  );

  if (existing.length > 0) {
    return res.json({ id: existing[0].id, type: "dm", targetUser });
  }

  const channelId = randomUUID();
  await pool.execute(
    "INSERT INTO channels (id, type, dm_key, created_by) VALUES (?, 'dm', ?, ?)",
    [channelId, dmKey, req.user.id]
  );
  await pool.execute(
    "INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'member'), (?, ?, 'member')",
    [channelId, req.user.id, channelId, targetUserId]
  );

  res.status(201).json({ id: channelId, type: "dm", targetUser });
});

router.get("/", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT DISTINCT c.id, c.name, c.description, c.announcement, c.type, c.created_at, cm.role
     FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.type = 'public' OR cm.user_id IS NOT NULL
     ORDER BY c.created_at ASC`,
    [req.user.id]
  );

  const dmChannelIds = rows.filter((r) => r.type === "dm").map((r) => r.id);
  let dmPartners = {};
  if (dmChannelIds.length > 0) {
    const placeholders = dmChannelIds.map(() => "?").join(",");
    const [partnerRows] = await pool.query(
      `SELECT cm.channel_id, u.id AS user_id, u.nickname
       FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.channel_id IN (${placeholders}) AND cm.user_id != ?`,
      [...dmChannelIds, req.user.id]
    );
    dmPartners = Object.fromEntries(partnerRows.map((p) => [p.channel_id, p]));
  }

  const result = rows.map((r) =>
    r.type === "dm" ? { ...r, partner: dmPartners[r.id] || null } : r
  );
  res.json(result);
});

router.post("/", async (req, res) => {
  const { name, type } = req.body || {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "频道名不能为空" });
  }
  const channelType = type === "private" ? "private" : "public";

  const channelId = randomUUID();
  await pool.execute(
    "INSERT INTO channels (id, name, type, created_by) VALUES (?, ?, ?, ?)",
    [channelId, name.trim(), channelType, req.user.id]
  );
  await pool.execute(
    "INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'admin')",
    [channelId, req.user.id]
  );

  res.status(201).json({ id: channelId, name: name.trim(), type: channelType, role: "admin" });
});

router.patch("/:id", async (req, res) => {
  const { id: channelId } = req.params;
  const membership = await getMembership(channelId, req.user.id);
  if (!membership || membership.role !== "admin") {
    return res.status(403).json({ error: "只有频道管理员能修改频道资料" });
  }
  const [currentRows] = await pool.execute("SELECT name, type FROM channels WHERE id = ?", [channelId]);
  const current = currentRows[0];
  if (!current || current.type === "dm") return res.status(400).json({ error: "该频道不能修改" });

  const name = typeof req.body.name === "string" ? req.body.name.trim() : current.name;
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const announcement = typeof req.body.announcement === "string" ? req.body.announcement.trim() : "";
  if (!name || name.length > 100) return res.status(400).json({ error: "频道名需要为 1–100 个字符" });
  if (description.length > 300) return res.status(400).json({ error: "频道描述不能超过 300 个字符" });
  if (announcement.length > 1000) return res.status(400).json({ error: "频道公告不能超过 1000 个字符" });

  await pool.execute(
    "UPDATE channels SET name = ?, description = ?, announcement = ? WHERE id = ?",
    [name, description || null, announcement || null, channelId]
  );
  const channel = { id: channelId, name, description, announcement, type: current.type };
  realtimeEvents.emit("channel-updated", channel);
  res.json(channel);
});

router.post("/:id/members", async (req, res) => {
  const { id: channelId } = req.params;
  const { userId } = req.body || {};

  const membership = await getMembership(channelId, req.user.id);
  if (!membership || membership.role !== "admin") {
    return res.status(403).json({ error: "只有频道管理员能邀请成员" });
  }

  if (typeof userId !== "string" || userId === req.user.id) {
    return res.status(400).json({ error: "用户不合法" });
  }
  const [users] = await pool.execute("SELECT id FROM users WHERE id = ?", [userId]);
  if (users.length === 0) return res.status(404).json({ error: "用户不存在" });

  await pool.execute(
    "INSERT IGNORE INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'member')",
    [channelId, userId]
  );
  const [channels] = await pool.execute(
    "SELECT id, name, type, created_at FROM channels WHERE id = ?",
    [channelId]
  );
  realtimeEvents.emit("channel-member-added", {
    userId,
    channel: { ...channels[0], role: "member" },
  });
  res.status(201).json({ ok: true });
});

router.get("/:id/members", async (req, res) => {
  const { id: channelId } = req.params;
  const [channels] = await pool.execute("SELECT type FROM channels WHERE id = ?", [channelId]);
  const channel = channels[0];
  if (!channel) return res.status(404).json({ error: "频道不存在" });
  const requesterMembership = await getMembership(channelId, req.user.id);
  if (channel.type !== "public" && !requesterMembership) {
    return res.status(403).json({ error: "无权查看频道成员" });
  }

  const [rows] = channel.type === "public"
    ? await pool.execute(
      `SELECT u.id, u.nickname, p.avatar_key, p.updated_at,
              CASE WHEN cm.role = 'admin' THEN 'admin' ELSE 'member' END AS role
       FROM users u
       LEFT JOIN channel_members cm ON cm.channel_id = ? AND cm.user_id = u.id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ORDER BY role ASC, u.nickname ASC`,
      [channelId]
    )
    : await pool.execute(
      `SELECT u.id, u.nickname, p.avatar_key, p.updated_at, cm.role
       FROM channel_members cm JOIN users u ON u.id = cm.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE cm.channel_id = ? ORDER BY cm.role ASC, u.nickname ASC`,
      [channelId]
    );

  res.json(rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    role: row.role,
    avatarVersion: row.avatar_key ? new Date(row.updated_at || Date.now()).getTime() : null,
  })));
});

router.get("/:id/mentionable-users", async (req, res) => {
  const { id: channelId } = req.params;
  const [channels] = await pool.execute("SELECT type FROM channels WHERE id = ?", [channelId]);
  const channel = channels[0];
  if (!channel) return res.status(404).json({ error: "频道不存在" });
  if (channel.type !== "public" && !(await getMembership(channelId, req.user.id))) {
    return res.status(403).json({ error: "无权访问该频道" });
  }
  const [rows] = channel.type === "public"
    ? await pool.execute("SELECT id, nickname FROM users WHERE id != ? ORDER BY nickname", [req.user.id])
    : await pool.execute(
      `SELECT u.id, u.nickname FROM channel_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.channel_id = ? AND u.id != ? ORDER BY u.nickname`,
      [channelId, req.user.id]
    );
  res.json(rows);
});

router.get("/:id/messages/search", async (req, res) => {
  const { id: channelId } = req.params;
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 2) return res.status(400).json({ error: "至少输入 2 个字符" });
  const [channels] = await pool.execute("SELECT type FROM channels WHERE id = ?", [channelId]);
  if (!channels[0]) return res.status(404).json({ error: "频道不存在" });
  if (channels[0].type !== "public" && !(await getMembership(channelId, req.user.id))) return res.status(403).json({ error: "无权搜索该频道" });
  const [rows] = await pool.execute(
    `SELECT m.id, m.text, m.created_at, u.id AS user_id, u.nickname
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? AND m.text LIKE ? ORDER BY m.created_at DESC LIMIT 50`,
    [channelId, `%${query}%`]
  );
  res.json(rows.map((row) => ({ id: row.id, text: row.text, userId: row.user_id, nickname: row.nickname, timestamp: new Date(row.created_at).getTime() })));
});

router.delete("/:id/members/:userId", async (req, res) => {
  const { id: channelId, userId } = req.params;

  const isSelf = userId === req.user.id;
  const membership = await getMembership(channelId, req.user.id);
  const isAdmin = membership?.role === "admin";

  const [channels] = await pool.execute("SELECT type FROM channels WHERE id = ?", [channelId]);
  if (!channels[0] || channels[0].type !== "private") {
    return res.status(400).json({ error: "只有私密频道支持移除成员" });
  }

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: "没有权限移除这个成员" });
  }

  await pool.execute(
    "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
    [channelId, userId]
  );
  realtimeEvents.emit("channel-member-removed", { channelId, userId });
  res.status(204).end();
});

async function getMembership(channelId, userId) {
  const [rows] = await pool.execute(
    "SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?",
    [channelId, userId]
  );
  return rows[0] || null;
}

export default router;
