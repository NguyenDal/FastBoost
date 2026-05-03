function requireEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

const env = {
  nodeEnv: getOptionalEnv("NODE_ENV") || "development",

  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),

  awsRegion: requireEnv("AWS_REGION"),
  orderPasswordKmsKeyId: requireEnv("ORDER_PASSWORD_KMS_KEY_ID"),
};

module.exports = {
  env,
  requireEnv,
  getOptionalEnv,
};