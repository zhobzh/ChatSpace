import express from "express";
import cookieParser from "cookie-parser";
import http from "http";
import { randomUUID } from "crypto";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import cors from "cors";

import { pool } from "./db.js";
import authRoutes from "./authRoutes.js";
import channelRoutes, { DEFAULT_CHANNEL_ID } from "./channelRoutes.js";
import usersRoutes from "./usersRoutes.js";
import uploadRoutes from "./uploadRoutes.js";
import profileRoutes from "./profileRoutes.js";
import { getUserBySessionId, parseCookies, SESSION_COOKIE_NAME } from "./sessionUtils.js";
import { realtimeEvents } from "./realtimeEvents.js";

dotenv.config();

const PORT = process.env.PORT || 4000;
const HISTORY_LIMIT = 50;

const app = express();
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRoutes);
app.use("/channels", channelRoutes);
app.use("/users", usersRoutes);
app.use("/uploads", uploadRoutes);
app.use("/profiles", profileRoutes);

const httpServer = http.createServer(app);

// noServer: true —— 自己接管 upgrade 事件，这样能在握手阶段先做 session 校验，
// 校验不通过的话直接拒绝，都不进入 wss 的 connection 事件
const wss = new WebSocketServer({ noServer: true });

// ws -> { id, email, nickname }，仅保存在内存里，用于广播在线用户列表（这是易失的展示数据，不需要落库）
const onlineUsers = new Map();

realtimeEvents.on("channel-member-added", ({ userId, channel }) => {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN && client.user?.id === userId) {
      client.send(JSON.stringify({ type: "channel_added", channel }));
    }
  });
});

realtimeEvents.on("channel-updated", (channel) => {
  wss.clients.forEach(async (client) => {
    if (client.readyState === client.OPEN && await canAccessChannel(channel.id, client.user.id)) {
      client.send(JSON.stringify({ type: "channel_updated", channel }));
    }
  });
});

realtimeEvents.on("channel-member-removed", ({ channelId, userId }) => {
  wss.clients.forEach((client) => {
    if (client.readyState !== client.OPEN) return;
    if (client.user.id === userId) client.send(JSON.stringify({ type: "channel_removed", channelId }));
    else if (client.channelId === channelId) client.send(JSON.stringify({ type: "channel_member_removed", channelId, userId }));
  });
});

realtimeEvents.on("profile-updated", (profile) => {
  onlineUsers.forEach((user, socket) => {
    if (user.id === profile.userId) {
      socket.user = { ...socket.user, nickname: profile.nickname };
      onlineUsers.set(socket, { ...user, nickname: profile.nickname });
    }
  });
  broadcast({ type: "profile_updated", profile });
  broadcastUsers();
});

httpServer.on("upgrade", async (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  const user = await getUserBySessionId(sessionId);

  if (!user) {
    // 401 + 直接断开底层 socket，不完成 WebSocket 握手
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, user);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

async function broadcastUsers() {
  // 同一个账号可能开多个标签页；在线列表按用户去重，而不是按 socket 展示。
  const uniqueUsers = new Map(
    Array.from(onlineUsers.values()).map((user) => [user.id, user])
  );
  const ids = Array.from(uniqueUsers.keys());
  if (ids.length === 0) return broadcast({ type: "users", users: [], count: 0 });
  const placeholders = ids.map(() => "?").join(",");
  const [profiles] = await pool.query(
    `SELECT u.id, u.nickname, p.full_name, p.bio, p.avatar_key, p.presence_status, p.updated_at
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id IN (${placeholders})`, ids
  );
  const list = profiles.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    fullName: row.full_name || "",
    bio: row.bio || "",
    status: row.presence_status || "online",
    avatarVersion: row.avatar_key ? new Date(row.updated_at || Date.now()).getTime() : null,
  }));
  broadcast({ type: "users", users: list, count: list.length });
}

async function canAccessChannel(channelId, userId) {
  const [rows] = await pool.execute(
    `SELECT c.id
     FROM channels c
     LEFT JOIN channel_members cm
       ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ? AND (c.type = 'public' OR cm.user_id IS NOT NULL)
     LIMIT 1`,
    [userId, channelId]
  );
  return rows.length > 0;
}

async function loadChannels(userId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT c.id, c.name, c.description, c.announcement, c.type, c.created_at, cm.role,
       (SELECT COUNT(*) FROM messages mx WHERE mx.channel_id = c.id AND mx.created_at > COALESCE(
         (SELECT cr.last_read_at FROM channel_reads cr WHERE cr.channel_id = c.id AND cr.user_id = ?), '1970-01-01'
       )) AS unread_count,
       EXISTS(SELECT 1 FROM message_mentions mm JOIN messages mmx ON mmx.id = mm.message_id
         WHERE mm.user_id = ? AND mmx.channel_id = c.id AND mmx.created_at > COALESCE(
           (SELECT cr2.last_read_at FROM channel_reads cr2 WHERE cr2.channel_id = c.id AND cr2.user_id = ?), '1970-01-01'
         )) AS has_mention
     FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.type = 'public' OR cm.user_id IS NOT NULL
     ORDER BY c.created_at ASC`,
    [userId, userId, userId, userId]
  );

  const dmIds = rows.filter((row) => row.type === "dm").map((row) => row.id);
  if (dmIds.length === 0) return rows;

  const placeholders = dmIds.map(() => "?").join(",");
  const [partners] = await pool.query(
    `SELECT cm.channel_id, u.id AS user_id, u.nickname
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id IN (${placeholders}) AND cm.user_id != ?`,
    [...dmIds, userId]
  );
  const byChannel = Object.fromEntries(
    partners.map((partner) => [partner.channel_id, partner])
  );
  return rows.map((row) =>
    row.type === "dm" ? { ...row, partner: byChannel[row.id] || null } : row
  );
}

async function loadRecentHistory(channelId, before = null) {
  const beforeClause = Number.isFinite(before) ? "AND m.created_at < FROM_UNIXTIME(?)" : "";
  const params = Number.isFinite(before) ? [channelId, before / 1000] : [channelId];
  const [rows] = await pool.execute(
    `SELECT m.id, m.channel_id, m.text, m.created_at, u.id AS user_id, u.nickname,
            p.avatar_key, p.updated_at AS profile_updated_at
     FROM messages m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE m.channel_id = ?
     ${beforeClause}
     ORDER BY m.created_at DESC
     LIMIT ${HISTORY_LIMIT + 1}`,
    params
  );
  const hasMore = rows.length > HISTORY_LIMIT;
  const messages = rows.slice(0, HISTORY_LIMIT).reverse().map((row) => ({
    type: "message",
    id: row.id,
    channelId: row.channel_id,
    text: row.text,
    nickname: row.nickname,
    userId: row.user_id,
    timestamp: new Date(row.created_at).getTime(),
    avatarVersion: row.avatar_key ? new Date(row.profile_updated_at).getTime() : null,
  }));
  if (messages.length === 0) return { messages, hasMore: false };
  const placeholders = messages.map(() => "?").join(",");
  const [attachments] = await pool.query(
    `SELECT id, message_id, original_name, mime_type, kind, size
     FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
    messages.map((message) => message.id)
  );
  const [mentions] = await pool.query(
    `SELECT mm.message_id, u.id, u.nickname FROM message_mentions mm
     JOIN users u ON u.id = mm.user_id WHERE mm.message_id IN (${placeholders})`,
    messages.map((message) => message.id)
  );
  const grouped = new Map();
  attachments.forEach((item) => {
    const list = grouped.get(item.message_id) || [];
    list.push({ id: item.id, originalName: item.original_name, mimeType: item.mime_type, kind: item.kind, size: Number(item.size) });
    grouped.set(item.message_id, list);
  });
  const mentionsByMessage = new Map();
  mentions.forEach((item) => {
    const list = mentionsByMessage.get(item.message_id) || [];
    list.push({ id: item.id, nickname: item.nickname });
    mentionsByMessage.set(item.message_id, list);
  });
  return {
    messages: messages.map((message) => ({ ...message, attachments: grouped.get(message.id) || [], mentions: mentionsByMessage.get(message.id) || [] })),
    hasMore,
  };
}

wss.on("connection", async (ws, req, user) => {
  ws.user = user;
  onlineUsers.set(ws, user);
  await broadcastUsers();

  try {
    const channels = await loadChannels(user.id);
    ws.send(JSON.stringify({ type: "channels", channels }));
  } catch (err) {
    console.error("加载频道列表失败:", err);
  }

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "message") {
      const text = typeof data.text === "string" ? data.text.trim() : "";
      const attachmentIds = Array.isArray(data.attachmentIds)
        ? [...new Set(data.attachmentIds)].slice(0, 5)
        : [];
      const requestedMentionIds = Array.isArray(data.mentionIds)
        ? [...new Set(data.mentionIds)].slice(0, 20)
        : [];
      const channelId = data.channelId || ws.channelId;
      if ((!text && attachmentIds.length === 0) || !channelId || !(await canAccessChannel(channelId, ws.user.id))) return;

      const messageId = randomUUID();
      let attachments = [];
      let mentions = [];
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (attachmentIds.length > 0) {
          const placeholders = attachmentIds.map(() => "?").join(",");
          const [rows] = await connection.query(
            `SELECT id, original_name, mime_type, kind, size FROM attachments
             WHERE id IN (${placeholders}) AND channel_id = ? AND user_id = ?
               AND message_id IS NULL AND status = 'ready' FOR UPDATE`,
            [...attachmentIds, channelId, ws.user.id]
          );
          if (rows.length !== attachmentIds.length) throw new Error("附件无效或已被发送");
          attachments = rows.map((item) => ({
            id: item.id,
            originalName: item.original_name,
            mimeType: item.mime_type,
            kind: item.kind,
            size: Number(item.size),
          }));
        }
        if (requestedMentionIds.length > 0) {
          const placeholders = requestedMentionIds.map(() => "?").join(",");
          const accessCondition = `EXISTS (
            SELECT 1 FROM channels c LEFT JOIN channel_members cm
              ON cm.channel_id = c.id AND cm.user_id = u.id
            WHERE c.id = ? AND (c.type = 'public' OR cm.user_id IS NOT NULL)
          )`;
          const [rows] = await connection.query(
            `SELECT u.id, u.nickname FROM users u
             WHERE u.id IN (${placeholders}) AND ${accessCondition}`,
            [...requestedMentionIds, channelId]
          );
          mentions = rows.filter((mention) => text.includes(`@${mention.nickname}`));
        }
        await connection.execute(
          "INSERT INTO messages (id, channel_id, user_id, text) VALUES (?, ?, ?, ?)",
          [messageId, channelId, ws.user.id, text]
        );
        if (attachmentIds.length > 0) {
          const placeholders = attachmentIds.map(() => "?").join(",");
          await connection.query(
            `UPDATE attachments SET message_id = ? WHERE id IN (${placeholders})`,
            [messageId, ...attachmentIds]
          );
        }
        if (mentions.length > 0) {
          await connection.query(
            "INSERT INTO message_mentions (message_id, user_id) VALUES ?",
            [mentions.map((mention) => [messageId, mention.id])]
          );
        }
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        console.error("消息落库失败:", err);
        return;
      } finally {
        connection.release();
      }

      const outgoingMessage = {
        type: "message",
        id: messageId,
        channelId,
        text,
        nickname: ws.user.nickname,
        userId: ws.user.id,
        timestamp: Date.now(),
        attachments,
        mentions,
      };
      const [senderProfiles] = await pool.execute(
        "SELECT avatar_key, updated_at FROM user_profiles WHERE user_id = ?",
        [ws.user.id]
      );
      if (senderProfiles[0]?.avatar_key) {
        outgoingMessage.avatarVersion = new Date(senderProfiles[0].updated_at).getTime();
      }
      // 发给所有有权访问该频道的在线用户，客户端才能为后台频道累计未读数。
      await Promise.all(Array.from(wss.clients).map(async (client) => {
        if (
          client.readyState === client.OPEN &&
          await canAccessChannel(channelId, client.user.id)
        ) {
          client.send(JSON.stringify(outgoingMessage));
          if (client.channelId === channelId) {
            await pool.execute(
              `INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?, ?, NOW(3))
               ON DUPLICATE KEY UPDATE last_read_at = NOW(3)`,
              [channelId, client.user.id]
            );
          }
        }
      }));
      return;
    }

    if (data.type === "join") {
      const channelId = data.channelId;
      if (typeof channelId !== "string" || !(await canAccessChannel(channelId, ws.user.id))) {
        ws.send(JSON.stringify({ type: "error", error: "无权访问该频道" }));
        return;
      }
      ws.channelId = channelId;
      try {
        await pool.execute(
          `INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?, ?, NOW(3))
           ON DUPLICATE KEY UPDATE last_read_at = NOW(3)`,
          [channelId, ws.user.id]
        );
        const history = await loadRecentHistory(channelId);
        ws.send(JSON.stringify({ type: "history", channelId, ...history }));
      } catch (err) {
        console.error("加载历史消息失败:", err);
      }
      return;
    }

    if (data.type === "load_history") {
      const channelId = data.channelId;
      if (typeof channelId !== "string" || !(await canAccessChannel(channelId, ws.user.id))) return;
      try {
        const history = await loadRecentHistory(channelId, Number(data.before));
        ws.send(JSON.stringify({ type: "history", channelId, ...history, prepend: true }));
      } catch (err) {
        console.error("加载更多聊天记录失败:", err);
      }
      return;
    }

    if (data.type === "typing") {
      broadcast({
        type: "typing",
        channelId: ws.channelId,
        nickname: ws.user.nickname,
        typing: !!data.typing,
      });
      return;
    }

    if (data.type === "presence") {
      const status = ["online", "busy", "away"].includes(data.status) ? data.status : null;
      if (!status) return;
      await pool.execute(
        `INSERT INTO user_profiles (user_id, presence_status) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE presence_status = VALUES(presence_status)`,
        [ws.user.id, status]
      );
      await broadcastUsers();
      return;
    }
  });

  ws.on("close", async () => {
    onlineUsers.delete(ws);
    const stillOnline = Array.from(onlineUsers.values()).some((item) => item.id === ws.user.id);
    if (!stillOnline) {
      await pool.execute(
        `INSERT INTO user_profiles (user_id, last_seen_at) VALUES (?, NOW())
         ON DUPLICATE KEY UPDATE last_seen_at = NOW()`,
        [ws.user.id]
      );
      broadcast({ type: "presence_updated", userId: ws.user.id, status: "offline", lastSeenAt: new Date().toISOString() });
    }
    await broadcastUsers();
  });
});

// 旧数据库可能是在频道功能加入前初始化的；启动时补齐默认公共频道。
for (const [column, definition] of [
  ["description", "VARCHAR(300) NULL"],
  ["announcement", "VARCHAR(1000) NULL"],
]) {
  const [columns] = await pool.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channels' AND COLUMN_NAME = ?`,
    [column]
  );
  if (columns.length === 0) await pool.query(`ALTER TABLE channels ADD COLUMN ${column} ${definition}`);
}
const [messageTimestampColumns] = await pool.execute(
  `SELECT DATETIME_PRECISION FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'created_at'`
);
if (Number(messageTimestampColumns[0]?.DATETIME_PRECISION || 0) !== 3) {
  await pool.query("ALTER TABLE messages MODIFY created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)");
}
await pool.execute(`CREATE TABLE IF NOT EXISTS user_profiles (
  user_id CHAR(36) PRIMARY KEY, full_name VARCHAR(100) NULL, bio VARCHAR(160) NULL,
  avatar_key VARCHAR(255) NULL, avatar_mime VARCHAR(100) NULL,
  presence_status ENUM('online', 'busy', 'away') NOT NULL DEFAULT 'online',
  last_seen_at TIMESTAMP NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB`);
await pool.execute(`CREATE TABLE IF NOT EXISTS attachments (
  id CHAR(36) PRIMARY KEY, message_id CHAR(36) NULL, channel_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL, object_key VARCHAR(255) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(100) NOT NULL,
  kind ENUM('image', 'file') NOT NULL, size BIGINT NOT NULL,
  status ENUM('ready', 'failed') NOT NULL DEFAULT 'ready', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_attachments_message (message_id)
) ENGINE=InnoDB`);
await pool.execute(`CREATE TABLE IF NOT EXISTS message_mentions (
  message_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB`);
await pool.execute(`CREATE TABLE IF NOT EXISTS channel_reads (
  channel_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
  last_read_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB`);
await pool.execute(`CREATE TABLE IF NOT EXISTS email_verification_codes (
  email VARCHAR(255) PRIMARY KEY, code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL, requested_at TIMESTAMP NOT NULL, attempts INT NOT NULL DEFAULT 0
) ENGINE=InnoDB`);
await pool.execute(
  "INSERT IGNORE INTO channels (id, name, type, created_by) VALUES (?, '全体', 'public', NULL)",
  [DEFAULT_CHANNEL_ID]
);

httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server running on http://localhost:${PORT} (ws path: /ws)`);
});
