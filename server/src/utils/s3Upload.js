const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
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

module.exports = {
  uploadProfileImageToS3,
};