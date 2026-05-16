import crypto from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node tools/generate-dashboard-auth.mjs <password>");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
const sessionSecret = crypto.randomBytes(32).toString("base64url");

console.log(`DASHBOARD_AUTH_PASSWORD_HASH=scrypt$${salt}$${passwordHash}`);
console.log(`DASHBOARD_SESSION_SECRET=${sessionSecret}`);
