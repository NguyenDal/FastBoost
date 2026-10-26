const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

const BUCKET = process.env.AWS_S3_ASSETS_BUCKET || "fastboost-assets";

function detectedImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ["image/png", "png"];
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return ["image/jpeg", "jpg"];
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return ["image/gif", "gif"];
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ["image/webp", "webp"];
  return null;
}

async function uploadProfileImageToS3({ userId, file }) {
  if (!file) {
    throw Object.assign(new Error("No file provided"), { status: 400 });
  }

  const imageType = detectedImageType(file.buffer);
  if (!imageType || imageType[0] !== file.mimetype) {
    throw Object.assign(new Error("Only JPG, PNG, WEBP, or GIF images are allowed."), { status: 400 });
  }

  const [contentType, ext] = imageType;
  const randomId = crypto.randomBytes(12).toString("hex");

  const key = `profiles/${userId}/${Date.now()}-${randomId}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: contentType,
      CacheControl: "private, no-store",
    })
  );

  return { key };
}

function keyFromOwnedS3Url(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const bucket = BUCKET.toLowerCase();
  let key;
  if (host === `${bucket}.s3.amazonaws.com` ||
      new RegExp(`^${bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.s3[.-][a-z0-9-]+\\.amazonaws\\.com$`).test(host)) {
    key = url.pathname.slice(1);
  } else if (host === 's3.amazonaws.com' || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(host)) {
    const prefix = `/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    key = url.pathname.slice(prefix.length);
  } else return null;
  try { return decodeURIComponent(key); } catch { return null; }
}

function profileKeyFromValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim().startsWith('profiles/') ? value.trim() : keyFromOwnedS3Url(value.trim());
  if (!key) return null;
  // Keys written by this service contain only generated segments. Reject path
  // traversal and arbitrary S3 objects even when a stored URL is malformed.
  return /^profiles\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9._-]{1,200}\.(?:jpg|jpeg|png|gif|webp)$/i.test(key) ? key : null;
}

function chatAttachmentKeyFromUrl(value) {
  if (typeof value !== 'string') return null;
  const key = keyFromOwnedS3Url(value);
  // Only recover keys created by this service; never sign arbitrary S3 paths
  // supplied through a historical database URL.
  return /^chat-attachments\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[0-9]+-[a-f0-9]{24}\.[a-z0-9]{1,6}$/i.test(key || '') ? key : null;
}

async function createProfileImageSignedUrl(key) {
  if (profileKeyFromValue(key) !== key) throw new Error('Invalid profile image key');
  const contentType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[key.split('.').pop().toLowerCase()];
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentType: contentType,
    ResponseContentDisposition: 'inline',
    ResponseCacheControl: 'private, no-store',
  }), { expiresIn: 60 * 15 });
}

function getSafeFileExtension(originalName = "") {
  const parts = String(originalName).split(".");
  if (parts.length < 2) return "bin";
  return parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

function assertAllowedChatAttachment(file) {
  if (!file) {
    throw Object.assign(new Error("No file provided"), { status: 400 });
  }

  const ext = getSafeFileExtension(file.originalname);
  if (!["jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "doc", "docx", "xls", "xlsx", "zip", "rar", "7z"].includes(ext)) {
    throw Object.assign(new Error("This file type is not allowed for security reasons."), { status: 400 });
  }

  return ext;
}

async function uploadChatAttachmentToS3({ conversationId, userId, file }) {
  const ext = assertAllowedChatAttachment(file);
  const randomId = crypto.randomBytes(12).toString("hex");

  const key = `chat-attachments/${conversationId}/${userId}/${Date.now()}-${randomId}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      // Attachments are untrusted downloads. Never use a client-supplied MIME
      // type to render executable HTML/SVG on the asset origin.
      ContentType: "application/octet-stream",
      ContentDisposition: "attachment",
      CacheControl: "private, max-age=0, no-cache",
      Metadata: {
        originalName: encodeURIComponent(file.originalname || "attachment"),
      },
    })
  );

  return { key };
}

async function createChatAttachmentSignedUrl({ key, filename }) {
  if (!key) {
    throw new Error("Attachment key is required");
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    // Overrides also protect attachments stored before this upload policy.
    ResponseContentType: "application/octet-stream",
    ResponseContentDisposition: `attachment; filename="${String(filename || "attachment").replace(/["\r\n\\]/g, "")}"`,
  });

  return getSignedUrl(s3, command, {
    expiresIn: 60 * 5,
  });
}

module.exports = {
  uploadProfileImageToS3,
  profileKeyFromValue,
  chatAttachmentKeyFromUrl,
  createProfileImageSignedUrl,
  uploadChatAttachmentToS3,
  createChatAttachmentSignedUrl,
};
