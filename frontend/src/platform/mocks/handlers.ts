import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { apiBase } from "../api";
import type { EmissionFactor, Listing, ProvisionDevice, Role, Trade, User } from "../types";
import { dateAt, devices, factors, flags, forecasts, listings, readings, sellers, todayKwh, trades, users } from "./data";

const initialBalance = 3_482_650;
let availableG = initialBalance;
let nextListing = 105;
let nextTrade = 105;
let nextDevice = 301;
const sessions = new Map(users.map((user) => [`mock-session-${user.id}`, user]));
const fail = (status: number, error: string) => HttpResponse.json({ error }, { status });
const now = () => new Date().toISOString();

type RequestInfo = Parameters<HttpResponseResolver>[0];
function guard(role: Role | null, action: (user: User, info: RequestInfo) => Response | Promise<Response>): HttpResponseResolver {
  return (info) => {
    const sessionToken = info.request.headers.get("Authorization")?.slice("Bearer ".length);
    const user = sessionToken && sessions.get(sessionToken);
    if (!user) return fail(401, "Sign in to continue.");
    if (role && !user.roles.includes(role)) return fail(403, "Your account cannot access this workspace.");
    return action(user, info);
  };
}

const related = (trade: Trade, user: User) => trade.sellerOrgId === user.organisationId || trade.buyerOrgId === user.organisationId;
const findTrade = (id: string | readonly string[] | undefined, user: User) =>
  trades.find((trade) => trade.id === id && (related(trade, user) || user.roles.includes("ADMIN")));

export const handlers = [
  http.post(`${apiBase}/auth/login`, async ({ request }) => {
    const { email, password } = await request.json() as { email: string; password: string };
    const user = users.find((candidate) => candidate.email === email?.toLowerCase());
    return user && password === "demo1234"
      ? HttpResponse.json({ token: `mock-session-${user.id}`, user })
      : fail(401, "Email or password is incorrect.");
  }),
  http.get(`${apiBase}/auth/me`, guard(null, (user) => HttpResponse.json(user))),

  http.get(`${apiBase}/generator/summary`, guard("GENERATOR", (user) => {
    const reservedG = listings.filter((listing) => listing.sellerOrgId === user.organisationId && listing.status === "LISTED")
      .reduce((sum, listing) => sum + Number(listing.remainingG), 0);
    return HttpResponse.json({
      todayKwh, co2AvoidedTodayKg: todayKwh * 0.71, availableG: String(availableG), reservedG: String(reservedG),
      devices: devices.filter((device) => device.organisationId === user.organisationId)
        .map(({ deviceId, label, status, lastSeenAt }) => ({ deviceId, label, status, lastSeenAt })),
    });
  })),
  http.get(`${apiBase}/generator/generation`, guard("GENERATOR", (_user, { request }) => {
    const days = Number(new URL(request.url).searchParams.get("days") ?? 14);
    return HttpResponse.json(readings.slice(-days * 24));
  })),
  http.get(`${apiBase}/generator/forecast`, guard("GENERATOR", () => HttpResponse.json(forecasts))),
  http.get(`${apiBase}/listings/mine`, guard("GENERATOR", (user) =>
    HttpResponse.json(listings.filter((listing) => listing.sellerOrgId === user.organisationId)))),
  http.post(`${apiBase}/listings`, guard("GENERATOR", async (user, { request }) => {
    const { amountG, priceInrPerKg } = await request.json() as { amountG: number; priceInrPerKg: number };
    if (!Number.isSafeInteger(amountG) || amountG <= 0 || !Number.isFinite(priceInrPerKg) || priceInrPerKg <= 0) {
      return fail(400, "Enter an amount and a positive price.");
    }
    if (amountG > availableG) return fail(409, "There are not enough available units to create this listing.");
    const listing: Listing = {
      id: `LST-${nextListing++}`, sellerOrgId: user.organisationId, amountG: String(amountG), remainingG: String(amountG),
      priceInrPerKg: String(priceInrPerKg), status: "LISTED", createdAt: now(),
    };
    availableG -= amountG;
    listings.unshift(listing);
    return HttpResponse.json(listing, { status: 201 });
  })),
  http.post(`${apiBase}/listings/:id/cancel`, guard("GENERATOR", (user, { params }) => {
    const listing = listings.find((item) => item.id === params.id && item.sellerOrgId === user.organisationId);
    if (!listing) return fail(404, "Listing not found.");
    if (listing.status !== "LISTED") return fail(409, "Only open listings can be cancelled.");
    availableG += Number(listing.remainingG);
    listing.status = "CANCELLED";
    listing.remainingG = "0";
    return HttpResponse.json(listing);
  })),

  http.get(`${apiBase}/listings`, guard("BUYER", () => HttpResponse.json(
    listings.filter((listing) => listing.status === "LISTED").map(({ id, sellerOrgId, remainingG, priceInrPerKg, createdAt }) =>
      ({ id, sellerOrgName: sellers[sellerOrgId], remainingG, priceInrPerKg, createdAt })),
  ))),
  http.post(`${apiBase}/trades`, guard("BUYER", async (user, { request }) => {
    const { listingId, amountG } = await request.json() as { listingId: string; amountG: number };
    if (!Number.isSafeInteger(amountG) || amountG <= 0) return fail(400, "Enter a positive amount.");
    const listing = listings.find((item) => item.id === listingId);
    if (!listing) return fail(404, "Listing not found.");
    if (listing.status !== "LISTED" || amountG > Number(listing.remainingG)) return fail(409, "Insufficient remaining units.");
    listing.remainingG = String(Number(listing.remainingG) - amountG);
    if (listing.remainingG === "0") listing.status = "FILLED";
    const trade: Trade = {
      id: `TRD-${nextTrade++}`, listingId, buyerOrgId: user.organisationId, sellerOrgId: listing.sellerOrgId,
      amountG: String(amountG), priceInrPerKg: listing.priceInrPerKg,
      totalInr: (amountG / 1000 * Number(listing.priceInrPerKg)).toFixed(2),
      status: "SETTLED", tradeHash: `0x${crypto.randomUUID().replaceAll("-", "").padStart(64, "0")}`, settledAt: now(),
      anchor: { status: "PENDING", attempts: 0, updatedAt: now() },
    };
    trades.unshift(trade);
    return HttpResponse.json(trade, { status: 201 });
  })),
  http.get(`${apiBase}/trades/mine`, guard(null, (user) => HttpResponse.json(trades.filter((trade) => related(trade, user))))),
  http.get(`${apiBase}/trades/:id`, guard(null, (user, { params }) => {
    const trade = findTrade(params.id, user);
    return trade ? HttpResponse.json(trade) : fail(404, "Trade not found.");
  })),
  http.get(`${apiBase}/trades/:id/verify`, guard(null, (user, { params }) => {
    const trade = findTrade(params.id, user);
    if (!trade) return fail(404, "Trade not found.");
    if (trade.status !== "ANCHORED") return fail(422, "The trade is not anchored yet.");
    const match = trade.id !== "TRD-104";
    const onChainHash = match ? trade.tradeHash : `0x${"e".repeat(64)}`;
    return HttpResponse.json({ storedHash: trade.tradeHash, onChainHash, match });
  })),

  http.get(`${apiBase}/admin/overview`, guard("ADMIN", () => HttpResponse.json({
    devices: devices.length, flaggedReadings: flags.length, trades: trades.length,
    anchorHealth: {
      pending: trades.filter((trade) => trade.anchor?.status === "PENDING").length,
      inflight: trades.filter((trade) => trade.anchor?.status === "INFLIGHT").length,
      confirmed: trades.filter((trade) => trade.anchor?.status === "CONFIRMED").length,
      failed: trades.filter((trade) => trade.anchor?.status === "FAILED").length,
      walletBalanceEth: "0.0063",
    },
  }))),
  http.get(`${apiBase}/admin/devices`, guard("ADMIN", () => HttpResponse.json(devices))),
  http.post(`${apiBase}/admin/devices`, guard("ADMIN", async (_user, { request }) => {
    const { label, organisationId, ratedCapacityKw } = await request.json() as ProvisionDevice;
    if (!sellers[organisationId] || !Number.isFinite(ratedCapacityKw) || ratedCapacityKw <= 0) {
      return fail(400, "Enter a generator organisation ID and a positive rated capacity.");
    }
    const deviceId = `MTR-${nextDevice++}`;
    devices.unshift({ deviceId, label, organisationId, ratedCapacityKw, status: "active", createdAt: now(), lastSeenAt: null });
    return HttpResponse.json({ device_id: deviceId, device_secret: `demo-${crypto.randomUUID()}` }, { status: 201 });
  })),
  http.post(`${apiBase}/admin/devices/:id/revoke`, guard("ADMIN", (_user, { params }) => {
    const device = devices.find((item) => item.deviceId === params.id);
    if (!device) return fail(404, "Device not found.");
    device.status = "revoked";
    return HttpResponse.json({ device_id: device.deviceId, status: device.status });
  })),
  http.get(`${apiBase}/admin/readings/flagged`, guard("ADMIN", () => HttpResponse.json(flags))),
  http.get(`${apiBase}/admin/trades`, guard("ADMIN", () => HttpResponse.json(trades))),
  http.get(`${apiBase}/admin/emission-factors`, guard("ADMIN", () => HttpResponse.json(factors))),
  http.post(`${apiBase}/admin/emission-factors`, guard("ADMIN", async (_user, { request }) => {
    const body = await request.json() as Omit<EmissionFactor, "id">;
    if (factors.some((factor) => factor.version === body.version)) return fail(409, "This emission factor version already exists.");
    const factor: EmissionFactor = { ...body, id: crypto.randomUUID() };
    factors.unshift(factor);
    return HttpResponse.json(factor, { status: 201 });
  })),
  http.post(`${apiBase}/admin/anchors/:tradeId/retry`, guard("ADMIN", (_user, { params }) => {
    const trade = trades.find((item) => item.id === params.tradeId);
    if (!trade) return fail(404, "Trade not found.");
    if (trade.status !== "ANCHOR_FAILED") return fail(409, "Only failed anchors can be retried.");
    trade.status = "ANCHOR_PENDING";
    trade.anchor = { status: "PENDING", attempts: trade.anchor?.attempts ?? 0, updatedAt: dateAt(0) };
    return new HttpResponse(null, { status: 204 });
  })),
];
