import express from "express";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { pool } from "../shared/db.js";

type AppRole = "admin" | "operator";

type StoredUser = {
  id: number;
  username: string;
  role: AppRole;
  tenantId?: number;
};

const router = express.Router();
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const requireEnv = (key: string, fallback?: string): string => {
  const val = process.env[key];
  if (val && val.trim().length > 0) return val.trim();
  if (!IS_PROD && fallback) return fallback;
  throw new Error(`Missing required env: ${key}`);
};

const JWT_SECRET = requireEnv("JWT_SECRET", "dev-only-change-me-32-char-secret");
const JWT_EXPIRES_IN = "15m";

const ADMIN_USERNAME = requireEnv("ADMIN_USERNAME", "admin");
const ADMIN_PASSWORD_HASH = requireEnv("ADMIN_PASSWORD_HASH");

const OPERATOR_USERNAME = process.env.OPERATOR_USERNAME?.trim() || "operator";
const OPERATOR_PASSWORD_HASH = process.env.OPERATOR_PASSWORD_HASH?.trim() || "";

const verifyPassword = async (storedPassword: string, incomingPassword: string): Promise<boolean> => {
  const normalizedStored = String(storedPassword || "").trim();
  if (!normalizedStored) return false;

  if (normalizedStored.startsWith("$argon2")) {
    return argon2.verify(normalizedStored, incomingPassword);
  }

  return normalizedStored === incomingPassword;
};

const findUserFromDatabase = async (
  username: string,
  password: string
): Promise<StoredUser | null> => {
  const conn = await pool.getConnection();
  try {
    const [rows]: any = await conn.execute(
      `SELECT id, username, password, role, tenant_id
       FROM users
       WHERE username = ?
         AND role IN ('admin', 'operator')
       LIMIT 1`,
      [username]
    );

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;

    const isValid = await verifyPassword(String(row.password || ""), password);
    if (!isValid) return null;

    return {
      id: Number(row.id),
      username: String(row.username),
      role: String(row.role) === "admin" ? "admin" : "operator",
      tenantId: row.tenant_id == null ? undefined : Number(row.tenant_id),
    };
  } catch (error: any) {
    if (error?.code !== "ER_NO_SUCH_TABLE") {
      console.error("Database login query failed:", error);
    }
    return null;
  } finally {
    conn.release();
  }
};

const findUserByCredential = async (
  username: string,
  password: string
): Promise<StoredUser | null> => {
  try {
    const dbUser = await findUserFromDatabase(username, password);
    if (dbUser) {
      return dbUser;
    }

    if (username === ADMIN_USERNAME) {
      const isValid = await verifyPassword(ADMIN_PASSWORD_HASH, password);
      if (isValid) {
        return { id: 1, username: ADMIN_USERNAME, role: "admin", tenantId: 1 };
      }
    }

    if (OPERATOR_PASSWORD_HASH && username === OPERATOR_USERNAME) {
      const isValid = await verifyPassword(OPERATOR_PASSWORD_HASH, password);
      if (isValid) {
        return { id: 2, username: OPERATOR_USERNAME, role: "operator", tenantId: 1 };
      }
    }
  } catch (e) {
    console.error("Password verification error:", e);
  }
  return null;
};

const issueJWT = (user: StoredUser): string => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

const verifyJWT = (token: string): StoredUser | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      username: string;
      role: AppRole;
      tenantId?: number;
    };
    return {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      tenantId: decoded.tenantId,
    };
  } catch {
    return null;
  }
};

const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;
  const [type, token] = authHeader.split(" ");
  if (type?.toLowerCase() !== "bearer") return null;
  return token || null;
};

// 仅保留一套登录：POST /login（返回 token + user）。不再提供 /auth/login 重复实现。
router.post("/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const user = await findUserByCredential(username, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = issueJWT(user);

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = extractBearerToken(authHeader);

  if (!token) {
    return res.status(401).json({ code: 401, message: "Missing token" });
  }

  const user = verifyJWT(token);
  if (!user) {
    return res.status(401).json({ code: 401, message: "Invalid or expired token" });
  }

  return res.json({
    code: 0,
    data: {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    },
  });
});

// 仅保留 GET /me 做登录态校验，不再提供 /auth/verify 重复实现

router.post("/refresh", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = extractBearerToken(authHeader);

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  const user = verifyJWT(token);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const newToken = issueJWT(user);
  return res.json({ token: newToken });
});

export default router;
