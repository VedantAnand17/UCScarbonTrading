import type {
  AdminDevice, AdminOverview, DeviceCredentials, EmissionFactor, FlaggedReading,
  Forecast, Generation, GeneratorSummary, Listing, OpenListing, ProvisionDevice, Session, Trade, User, Verification,
} from "./types";

const configuredBase = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
export const apiBase = configuredBase.endsWith("/api/v1") ? configuredBase : `${configuredBase}/api/v1`;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = { method?: "POST"; body?: object; signal?: AbortSignal };

export function createApi(token?: string, onUnauthorized?: () => void) {
  async function request<T>(path: string, { method, body, signal }: RequestOptions = {}): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (body) headers.set("Content-Type", "application/json");

    const response = await fetch(`${apiBase}${path}`, {
      method, headers, body: body && JSON.stringify(body), signal,
    });
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    }

    if (response.status === 401) onUnauthorized?.();
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error || `The request failed (HTTP ${response.status}).`);
  }

  const id = encodeURIComponent;
  return {
    login: (email: string, password: string) => request<Session>("/auth/login", {
      method: "POST", body: { email, password },
    }),
    me: (signal: AbortSignal) => request<User>("/auth/me", { signal }),
    summary: (signal: AbortSignal) => request<GeneratorSummary>("/generator/summary", { signal }),
    generation: (signal: AbortSignal) => request<Generation[]>("/generator/generation?days=14", { signal }),
    forecast: (signal: AbortSignal) => request<Forecast[]>("/generator/forecast", { signal }),
    myListings: (signal: AbortSignal) => request<Listing[]>("/listings/mine", { signal }),
    createListing: (amountG: number, priceInrPerKg: number) =>
      request<Listing>("/listings", { method: "POST", body: { amountG, priceInrPerKg } }),
    cancelListing: (listingId: string) => request<Listing>(`/listings/${id(listingId)}/cancel`, { method: "POST" }),
    listings: (signal: AbortSignal) => request<OpenListing[]>("/listings", { signal }),
    buy: (listingId: string, amountG: number) =>
      request<Trade>("/trades", { method: "POST", body: { listingId, amountG } }),
    myTrades: (signal: AbortSignal) => request<Trade[]>("/trades/mine", { signal }),
    trade: (tradeId: string, signal: AbortSignal) => request<Trade>(`/trades/${id(tradeId)}`, { signal }),
    verify: (tradeId: string) => request<Verification>(`/trades/${id(tradeId)}/verify`),
    overview: (signal: AbortSignal) => request<AdminOverview>("/admin/overview", { signal }),
    devices: (signal: AbortSignal) => request<AdminDevice[]>("/admin/devices", { signal }),
    provision: (body: ProvisionDevice) => request<DeviceCredentials>("/admin/devices", { method: "POST", body }),
    revoke: (deviceId: string) => request<void>(`/admin/devices/${id(deviceId)}/revoke`, { method: "POST" }),
    flaggedReadings: (signal: AbortSignal) => request<FlaggedReading[]>("/admin/readings/flagged", { signal }),
    allTrades: (signal: AbortSignal) => request<Trade[]>("/admin/trades", { signal }),
    factors: (signal: AbortSignal) => request<EmissionFactor[]>("/admin/emission-factors", { signal }),
    createFactor: (body: Omit<EmissionFactor, "id">) =>
      request<EmissionFactor>("/admin/emission-factors", { method: "POST", body }),
    retryAnchor: (tradeId: string) => request<void>(`/admin/anchors/${id(tradeId)}/retry`, { method: "POST" }),
  };
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Could not reach the platform API. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}
