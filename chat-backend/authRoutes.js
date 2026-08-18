import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { createHash, randomInt } from "crypto";
import nodemailer from "nodemailer";
import { pool } from "./db.js";
import {
  createSession,
  deleteSession,
  getUserBySessionId,
  SESSION_COOKIE_NAME,
} from "./sessionUtils.js";

const router = Router();
const SALT_ROUNDS = 12;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax", // 前后端同源（同一个 host:port）时够用；跨域部署要改成 "none" + secure: true
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const hashCode = (email, code) => createHash("sha256").update(`${email.toLowerCase()}:${code}:${process.env.EMAIL_CODE_SECRET || "dev-secret"}`).digest("hex");

router.post("/send-verification-code", async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return res.status(400).json({ error: "邮箱格式不正确" });
  const [recent] = await pool.execute("SELECT requested_at FROM email_verification_codes WHERE email = ? AND requested_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)", [email]);
  if (recent.length) return res.status(429).json({ error: "请稍后再获取验证码" });

  const code = String(randomInt(100000, 1000000));
  await pool.execute(
    `INSERT INTO email_verification_codes (email, code_hash, expires_at, requested_at, attempts)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), NOW(), 0)
     ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash), expires_at=VALUES(expires_at), requested_at=NOW(), attempts=0`,
    [email, hashCode(email, code)]
  );

  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email, subject: "Chatspace 邮箱验证码",
      text: `你的验证码是 ${code}，10 分钟内有效。`,
      html: `<p>你的 Chatspace 验证码是：</p><h2 style="letter-spacing:4px">${code}</h2><p>验证码 10 分钟内有效。</p>`,
    });
  } else {
    console.log(`[开发环境邮箱验证码] ${email}: ${code}`);
  }
  res.json({ ok: true, ...(process.env.NODE_ENV !== "production" && !process.env.SMTP_HOST ? { devCode: code } : {}) });
});

router.post("/register", async (req, res) => {
  const { password, nickname, verificationCode } = req.body || {};
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "邮箱格式不正确" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "密码至少需要 8 位" });
  }
  const [codes] = await pool.execute(
    "SELECT code_hash, attempts FROM email_verification_codes WHERE email = ? AND expires_at > NOW()",
    [email]
  );
  const verification = codes[0];
  if (!verification || verification.attempts >= 5 || typeof verificationCode !== "string" || verification.code_hash !== hashCode(email, verificationCode.trim())) {
    if (verification) await pool.execute("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?", [email]);
    return res.status(400).json({ error: "验证码错误或已过期" });
  }

  const [existing] = await pool.execute(
    "SELECT id FROM users WHERE email = ?",
    [email]
  );
  if (existing.length > 0) {
    return res.status(409).json({ error: "该邮箱已被注册" });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = randomUUID();
  const finalNickname = nickname?.trim() || email.split("@")[0];

  await pool.execute(
    "INSERT INTO users (id, email, password_hash, nickname) VALUES (?, ?, ?, ?)",
    [userId, email, passwordHash, finalNickname]
  );
  await pool.execute("DELETE FROM email_verification_codes WHERE email = ?", [email]);

  const { sessionId } = await createSession(userId);
  res.cookie(SESSION_COOKIE_NAME, sessionId, cookieOptions);
  res.status(201).json({ id: userId, email, nickname: finalNickname });
});

router.post("/login", async (req, res) => {
  const { email, password, verificationCode } = req.body || {};

  if (!isValidEmail(email) || typeof password !== "string") {
    return res.status(400).json({ error: "邮箱或密码格式不正确" });
  }

  const [rows] = await pool.execute(
    "SELECT id, email, password_hash, nickname FROM users WHERE email = ?",
    [email]
  );
  const user = rows[0];

  // 用户不存在时也走一次 bcrypt.compare 对一个假 hash，避免通过响应时间差判断邮箱是否存在
  const passwordHash = user?.password_hash || "$2b$12$invalidsaltinvalidsaltinvalidsalOu";
  const valid = await bcrypt.compare(password, passwordHash);

  const [codes] = await pool.execute(
    "SELECT code_hash, attempts FROM email_verification_codes WHERE email = ? AND expires_at > NOW()",
    [typeof email === "string" ? email.trim().toLowerCase() : ""]
  );
  const verification = codes[0];
  const validCode = verification && verification.attempts < 5 && typeof verificationCode === "string" && verification.code_hash === hashCode(email.trim().toLowerCase(), verificationCode.trim());

  if (!user || !valid || !validCode) {
    if (verification && !validCode) await pool.execute("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?", [email.trim().toLowerCase()]);
    return res.status(401).json({ error: "邮箱、密码或验证码错误" });
  }

  const { sessionId } = await createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, sessionId, cookieOptions);
  await pool.execute("DELETE FROM email_verification_codes WHERE email = ?", [email.trim().toLowerCase()]);
  res.json({ id: user.id, email: user.email, nickname: user.nickname });
});

router.post("/logout", async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  await deleteSession(sessionId);
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.status(204).end();
});

router.get("/me", async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  const user = await getUserBySessionId(sessionId);
  if (!user) return res.status(401).json({ error: "未登录" });
  res.json(user);
});

export default router;
