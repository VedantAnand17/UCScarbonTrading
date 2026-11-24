const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const { publicUser, issueToken, authenticate } = require("../lib/auth");
const { HttpError, route } = require("../lib/http");

const router = express.Router();
// Keep the bcrypt comparison for unknown users so login timing doesn't reveal which emails exist.
const dummyHash = "$2b$12$YwJNPohDQ/LBy8iSzEPrmOWO.pOUxpVeZMhdUa7xI3WMqSSWL5AdO";

router.post("/login", route(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || !email.trim() || email.length > 254 ||
      typeof password !== "string" || !password || Buffer.byteLength(password) > 72) {
    throw new HttpError(400, "email and password are required");
  }
  const record = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { ...publicUser, passwordHash: true },
  });
  const valid = await bcrypt.compare(password, record?.passwordHash ?? dummyHash);
  if (!record || !valid) throw new HttpError(401, "invalid email or password");
  const { passwordHash, ...user } = record;
  res.json({ token: issueToken(user), user });
}));

router.get("/me", authenticate, (req, res) => res.json(req.user));

module.exports = router;
