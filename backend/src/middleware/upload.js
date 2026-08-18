import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");
export const CHANNEL_UPLOADS_DIR = path.join(UPLOADS_ROOT, "channels");

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/x-caf",
  "audio/caf",
]);

export function mediaKindFromMime(mime, filename = "") {
  const type = String(mime || "").toLowerCase().split(";")[0].trim();
  if (IMAGE_TYPES.has(type) || type.startsWith("image/")) return "image";
  if (VIDEO_TYPES.has(type) || type.startsWith("video/")) return "video";
  if (AUDIO_TYPES.has(type) || type.startsWith("audio/")) return "audio";

  // Some mobile browsers leave type empty — fall back to extension
  const ext = path.extname(filename || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(ext)) return "video";
  if ([".webm", ".ogg", ".mp3", ".m4a", ".aac", ".wav", ".caf"].includes(ext)) {
    return "audio";
  }
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(CHANNEL_UPLOADS_DIR);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, CHANNEL_UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 12);
    const safeExt = ext && /^\.[a-z0-9.]+$/i.test(ext) ? ext : "";
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cb(null, `${stamp}${safeExt}`);
  },
});

function fileFilter(_req, file, cb) {
  if (mediaKindFromMime(file.mimetype, file.originalname)) {
    cb(null, true);
    return;
  }
  cb(new Error("Unsupported media type. Use image, video, or audio."));
}

export const channelMediaUpload = multer({
  storage,
  fileFilter,
  limits: {
    // Videos up to ~50MB; images/audio usually much smaller
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
});

// Public URL path — keep relative so a CDN/S3 base can be prepended later
export function publicUploadPath(filename) {
  return `/uploads/channels/${filename}`;
}

export function unlinkUpload(filename) {
  if (!filename) return;
  const full = path.join(CHANNEL_UPLOADS_DIR, path.basename(filename));
  fs.unlink(full, () => {});
}
