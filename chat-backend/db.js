import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "chatuser",
  password: process.env.DB_PASSWORD || "chatpass",
  database: process.env.DB_NAME || "chatapp",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
