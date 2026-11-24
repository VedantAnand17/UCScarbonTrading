import type { Context } from "hono";

export type User = { id: string; name: string; email: string; roles: string[]; organisationId: string };
export type App = { Bindings: Env; Variables: { user: User; body: Record<string, unknown> } };
export type ApiContext = Context<App>;

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 422, message: string) {
    super(message);
  }
}

export const body = (c: ApiContext) => c.get("body") ?? {};

export function parseDate(value: unknown, field: string) {
  const date = new Date(typeof value === "string" ? value : "");
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, `${field} must be a valid date`);
  return date.toISOString();
}

type Parameter = string | number | null;
export const sql = (db: D1Database, statement: string, ...params: Parameter[]) => db.prepare(statement).bind(...params);
export const first = <T>(db: D1Database, statement: string, ...params: Parameter[]) =>
  sql(db, statement, ...params).first<T>();
export const all = async <T>(db: D1Database, statement: string, ...params: Parameter[]) =>
  (await sql(db, statement, ...params).all<T>()).results;
