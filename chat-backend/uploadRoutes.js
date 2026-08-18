import { Router, raw } from "express";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { getUserBySessionId, SESSION_COOKIE_NAME } from "./sessionUtils.js";

const router = Router();
const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "uploads");
const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

await mkdir(uploadDir, { recursive: true });

router.use(async (req, res, next) => {
  const user = await getUserBySessionId(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: "未登录" });
  req.user = user;
  next();
});

async function canAccess(channelId, userId) {
  const [rows] = await pool.execute(
    `SELECT c.id FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE c.id = ? AND (c.type = 'public' OR cm.user_id IS NOT NULL) LIMIT 1`,
    [userId, channelId]
  );
  return rows.length > 0;
}

function hasSignature(buffer, bytes, offset = 0) {
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function contentMatchesType(buffer, mimeType) {
  if (mimeType === "image/jpeg") return hasSignature(buffer, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return hasSignature(buffer, [0x89, 0x50, 0x4e, 0x47]);
  if (mimeType === "image/gif") return buffer.subarray(0, 4).toString() === "GIF8";
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (mimeType.includes("zip") || mimeType.includes("openxmlformats")) return hasSignature(buffer, [0x50, 0x4b]);
  if (["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(mimeType)) {
    return hasSignature(buffer, [0xd0, 0xcf, 0x11, 0xe0]);
  }
  if (mimeType === "text/plain" || mimeType === "text/csv") return !buffer.subarray(0, 1024).includes(0);
  return false;
}

router.post("/", raw({ type: () => true, limit: "20mb" }), async (req, res) => {
  const channelId = req.header("x-channel-id");
  const mimeType = (req.header("content-type") || "").split(";")[0].toLowerCase();
  let originalName = "file";
  try { originalName = decodeURIComponent(req.header("x-file-name") || "file"); } catch {}

  if (!(await canAccess(channelId, req.user.id))) return res.status(403).json({ error: "无权向该频道上传" });
  if (!allowedTypes.has(mimeType)) return res.status(415).json({ error: "不支持这种文件类型" });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "文件为空" });
  if (!contentMatchesType(req.body, mimeType)) return res.status(415).json({ error: "文件内容与类型不匹配" });

  const id = randomUUID();
  const objectKey = randomUUID();
  await writeFile(path.join(uploadDir, objectKey), req.body, { flag: "wx" });
  await pool.execute(
    `INSERT INTO attachments
      (id, channel_id, user_id, object_key, original_name, mime_type, kind, size, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    [id, channelId, req.user.id, objectKey, originalName.slice(0, 255), mimeType, mimeType.startsWith("image/") ? "image" : "file", req.body.length]
  );
  res.status(201).json({ id, channelId, originalName, mimeType, kind: mimeType.startsWith("image/") ? "image" : "file", size: req.body.length });
});

router.get("/:id/content", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT a.* FROM attachments a
     JOIN channels c ON c.id = a.channel_id
     LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
     WHERE a.id = ? AND (c.type = 'public' OR cm.user_id IS NOT NULL) LIMIT 1`,
    [req.user.id, req.params.id]
  );
  const attachment = rows[0];
  if (!attachment) return res.status(404).json({ error: "文件不存在" });
  try {
    const content = await readFile(path.join(uploadDir, attachment.object_key));
    res.set("Content-Type", attachment.mime_type);
    res.set("Content-Length", String(content.length));
    res.set("Cache-Control", "private, max-age=3600");
    res.set("Content-Disposition", `${attachment.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`);
    res.send(content);
  } catch {
    res.status(404).json({ error: "文件不存在" });
  }
});

router.delete("/:id", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT object_key FROM attachments WHERE id = ? AND user_id = ? AND message_id IS NULL",
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "附件不存在" });
  await pool.execute("DELETE FROM attachments WHERE id = ?", [req.params.id]);
  await unlink(path.join(uploadDir, rows[0].object_key)).catch(() => {});
  res.status(204).end();
});

export default router;
