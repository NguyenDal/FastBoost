const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

const BUCKET = process.env.AWS_S3_ASSETS_BUCKET || "fastboost-assets";

function getFileExtension(originalName = "") {
  const parts = originalName.split(".");
  if (parts.length < 2) return "jpg";
  return parts.pop().toLowerCase();
}

function makePublicS3Url(key) {
  return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}

async function uploadProfileImageToS3({ userId, file }) {
  if (!file) {
    throw new Error("No file provided");
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error("Only JPG, PNG, WEBP, or GIF images are allowed.");
  }

  const ext = getFileExtension(file.originalname);
  const randomId = crypto.randomBytes(12).toString("hex");

  const key = `profiles/${userId}/${Date.now()}-${randomId}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
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
    throw new Error("No file provided");
  }

  const blockedExtensions = [
    "exe",
    "bat",
    "cmd",
    "sh",
    "msi",
    "scr",
    "com",
    "js",
    "jar",
    "ps1",
    "vbs",
  ];

  const ext = getSafeFileExtension(file.originalname);

  if (blockedExtensions.includes(ext)) {
    throw new Error("This file type is not allowed for security reasons.");
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
      ContentType: file.mimetype || "application/octet-stream",
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
    ResponseContentDisposition: `inline; filename="${String(filename || "attachment").replace(/"/g, "")}"`,
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