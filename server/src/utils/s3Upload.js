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

function makePublicS3Url(key) {
  return `https://${BUCKET}.s3.amazonaws.com/${key}`;
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
      CacheControl: "public, max-age=31536000",
    })
  );

  return {
    key,
    url: makePublicS3Url(key),
  };
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

  return {
    key,
    url: makePublicS3Url(key),
  };
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
  uploadChatAttachmentToS3,
  createChatAttachmentSignedUrl,
};
