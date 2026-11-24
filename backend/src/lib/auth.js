const jwt = require("jsonwebtoken");
const prisma = require("./prisma");
const { HttpError, route } = require("./http");

const publicUser = { id: true, name: true, email: true, roles: true, organisationId: true };
const issuer = "ucs-carbon-trading";

function jwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new Error("JWT_SECRET requires at least 32 bytes");
  return value;
}

function issueToken(user) {
  return jwt.sign({}, jwtSecret(), { algorithm: "HS256", issuer, subject: user.id, expiresIn: "8h" });
}

const authenticate = route(async (req, _res, next) => {
  const token = /^Bearer (\S+)$/i.exec(req.get("Authorization") || "")?.[1];
  if (!token) throw new HttpError(401, "unauthorized");
  const secret = jwtSecret();
  let claims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ["HS256"], issuer });
  } catch {
    throw new HttpError(401, "unauthorized");
  }
  if (typeof claims.sub !== "string") throw new HttpError(401, "unauthorized");
  const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: publicUser });
  if (!user) throw new HttpError(401, "unauthorized");
  req.user = user;
  next();
});

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.some((role) => req.user.roles.includes(role))) return next(new HttpError(403, "forbidden"));
    next();
  };
}

module.exports = { authenticate, requireRole, issueToken, publicUser, jwtSecret };
