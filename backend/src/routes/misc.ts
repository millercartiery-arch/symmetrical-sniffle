import crypto from "crypto";
import express from "express";
import fs from "fs/promises";
import multer from "multer";
import path from "path";
import { detectLanguage, translateText } from "../shared/translate.js";

const router = express.Router();
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const upload = multer({ storage: multer.memoryStorage() });

const sanitizeFileName = (fileName: string) =>
  path.basename(fileName || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_");

const getRequestBaseUrl = (req: express.Request) => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host") || "localhost";
  return `${protocol}://${host}`;
};

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: "No file provided" });
      return;
    }
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const fileName = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${sanitizeFileName(file.originalname)}`;
    const absolutePath = path.join(UPLOADS_DIR, fileName);
    await fs.writeFile(absolutePath, file.buffer);
    const relativeUrl = `/uploads/${fileName}`;
    const url = `${getRequestBaseUrl(req)}${relativeUrl}`;
    res.json({ success: true, url, relativeUrl });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || "Upload failed" });
  }
});

router.post("/messages", async (req, res) => {
  try {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const content = String(req.body?.content || "").trim();
    const mediaUrl = req.body?.media_url || null;
    if (!content || targets.length === 0) {
      res.status(400).json({ success: false, error: "Missing content or targets" });
      return;
    }
    res.json({ success: true, count: targets.length, contentLength: content.length, mediaUrl });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || "Create messages failed" });
  }
});

router.post("/work-tasks", async (req, res) => {
  try {
    const payload = req.body || {};
    res.json({ success: true, task: { id: Date.now(), ...payload } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || "Create task failed" });
  }
});

router.post("/translate", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const targetLanguage = String(req.body?.targetLanguage || "en").trim().toLowerCase();
    const sourceLanguage = String(req.body?.sourceLanguage || "").trim().toLowerCase() || undefined;

    if (!text) {
      res.json({
        success: true,
        translatedText: "",
        detectedLanguage: sourceLanguage || null,
      });
      return;
    }

    const [translated] = await translateText(text, targetLanguage, sourceLanguage);
    let detectedLanguage = translated?.detectedLanguage;

    if (!detectedLanguage) {
      try {
        const detected = await detectLanguage(text);
        detectedLanguage = detected.language;
      } catch {
        detectedLanguage = sourceLanguage || undefined;
      }
    }

    res.json({
      success: true,
      translatedText: translated?.translatedText || "",
      detectedLanguage: detectedLanguage || null,
      targetLanguage,
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e?.message || "Translate failed",
    });
  }
});

/**
 * Tauri 自动更新检查接口
 * 按照 Tauri Updater 规范返回 JSON
 */
router.get("/update/check/:platform/:current_version", (req, res) => {
  const { platform, current_version } = req.params;
  
  // 这里可以根据实际发布的版本进行动态判断
  // 目前先返回一个静态示例，后续您可以修改版本号触发更新
  const latestVersion = "1.0.1"; 
  
  if (current_version === latestVersion) {
    return res.status(204).send(); // 无需更新
  }

  const updateData = {
    version: latestVersion,
    notes: "系统性能优化与功能更新",
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        "signature": "", // 如果开启了签名验证，需要在这里填入签名
        "url": `http://${req.hostname}:3000/downloads/TN_Matrix_${latestVersion}_x64_en-US.msi.zip`
      }
    }
  };

  res.json(updateData);
});

export default router;
