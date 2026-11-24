import { compare } from "bcryptjs";
import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import type { MiddlewareHandler } from "hono";
import { body, first, HttpError, type App, type User } from "./http";

const issuer = "ucs-carbon-trading";
const userFields = "id, name, email, roles, organisationId";
const dummyHash = "$2b$12$YwJNPohDQ/LBy8iSzEPrmOWO.pOUxpVeZMhdUa7xI3WMqSSWL5AdO";

type StoredUser = Omit<User, "roles"> & { roles: string };
const publicUser = (user: StoredUser): User => ({ ...user, roles: JSON.parse(user.roles) });

function signingSecret(env: Env) {
  if (!env.JWT_SECRET || new TextEncoder().encode(env.JWT_SECRET).length < 32) {
    throw new Error("JWT_SECRET requires at least 32 bytes");
  }
  return env.JWT_SECRET;
}

export const authenticate: MiddlewareHandler<App> = async (c, next) => {
  const token = /^Bearer (\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
  if (!token) throw new HttpError(401, "unauthorized");
  const secret = signingSecret(c.env);
  let id;
  try {
    const { sub } = await verify(token, secret, { alg: "HS256", iss: issuer, iat: false });
    id = sub;
  } catch {
    throw new HttpError(401, "unauthorized");
  }
  if (typeof id !== "string") throw new HttpError(401, "unauthorized");
  const user = await first<StoredUser>(c.env.DB, `SELECT ${userFields} FROM User WHERE id = ?`, id);
  if (!user) throw new HttpError(401, "unauthorized");
  c.set("user", publicUser(user));
  await next();
};

export const requireRole = (...roles: string[]): MiddlewareHandler<App> => async (c, next) => {
  if (!roles.some((role) => c.get("user").roles.includes(role))) throw new HttpError(403, "forbidden");
  await next();
};

export const auth = new Hono<App>({ strict: false });

auth.post("/login", async (c) => {
  const { email, password } = body(c);
  if (typeof email !== "string" || !email.trim() || email.length > 254 ||
      typeof password !== "string" || !password || new TextEncoder().encode(password).length > 72) {
    throw new HttpError(400, "email and password are required");
  }
  const record = await first<StoredUser & { passwordHash: string }>(
    c.env.DB, `SELECT ${userFields}, passwordHash FROM User WHERE email = ?`, email.trim().toLowerCase(),
  );
  const valid = await compare(password, record?.passwordHash ?? dummyHash);
  if (!record || !valid) throw new HttpError(401, "invalid email or password");
  const { passwordHash: _, ...fields } = record;
  const user = publicUser(fields);
  const iat = Math.floor(Date.now() / 1000);
  const token = await sign({ iat, exp: iat + 8 * 3600, iss: issuer, sub: user.id }, signingSecret(c.env), "HS256");
  return c.json({ token, user });
});

auth.get("/me", authenticate, (c) => c.json(c.get("user")));
