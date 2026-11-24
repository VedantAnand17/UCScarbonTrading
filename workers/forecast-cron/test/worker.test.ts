import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const { containerFetch, getContainer } = vi.hoisted(() => {
  const containerFetch = vi.fn();
  return { containerFetch, getContainer: vi.fn(() => ({ fetch: containerFetch })) };
});

vi.mock("@cloudflare/containers", () => ({ Container: class {}, getContainer }));

const env = {
  FORECAST_CONTAINER: {} as Parameters<typeof worker.fetch>[1]["FORECAST_CONTAINER"],
  FORECAST_API_URL: "https://forecast.example",
  FORECAST_API_EMAIL: "admin@example.com",
  FORECAST_API_PASSWORD: "test-password",
  CRON_TRIGGER_TOKEN: "test-token",
};
const result = { ok: true, devices: ["meter-one: sarima"], durationMs: 100 };
const controller = { cron: "30 18 * * *", scheduledTime: 0, noRetry: vi.fn() };

function request(method: string, path: string, authorization?: string) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

function expectContainerRun() {
  expect(getContainer).toHaveBeenCalledExactlyOnceWith(env.FORECAST_CONTAINER, "nightly");
  expect(containerFetch).toHaveBeenCalledExactlyOnceWith("http://container/run", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  containerFetch.mockReset().mockImplementation(async () => Response.json(result));
});

afterEach(() => vi.restoreAllMocks());

describe("manual runs", () => {
  it.each([undefined, "Basic test-token", "Bearer wrong-token", "Bearer test-token-extra"])(
    "rejects invalid authorization %s before contacting the container",
    async (authorization) => {
      const response = await worker.fetch(request("POST", "/run", authorization), env);
      expect(response.status).toBe(401);
      expect(getContainer).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the trigger secret is not configured", async () => {
    const response = await worker.fetch(request("POST", "/run", "Bearer test-token"), {
      ...env,
      CRON_TRIGGER_TOKEN: undefined,
    });
    expect(response.status).toBe(401);
    expect(getContainer).not.toHaveBeenCalled();
  });

  it.each([["GET", "/run"], ["POST", "/health"], ["POST", "/unknown"]])(
    "returns 404 for %s %s",
    async (method, path) => {
      expect((await worker.fetch(request(method, path, "Bearer test-token"), env)).status).toBe(404);
      expect(getContainer).not.toHaveBeenCalled();
    },
  );

  it("returns the container result for an authorized POST without forwarding credentials", async () => {
    const response = await worker.fetch(request("POST", "/run", "bEaReR test-token"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expectContainerRun();
  });

  it("preserves a busy response from the container", async () => {
    containerFetch.mockResolvedValueOnce(Response.json({ ok: false }, { status: 409 }));
    expect((await worker.fetch(request("POST", "/run", "Bearer test-token"), env)).status).toBe(409);
  });

  it("does not expose errors thrown by the container", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    containerFetch.mockRejectedValueOnce(new Error("internal detail"));
    const response = await worker.fetch(request("POST", "/run", "Bearer test-token"), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false });
  });
});

describe("scheduled runs", () => {
  it("runs the same singleton and logs its result", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await worker.scheduled(controller, env);
    expectContainerRun();
    expect(log).toHaveBeenCalledWith("Scheduled forecast result", { status: 200, result });
  });

  it("logs a failed result and fails the scheduled event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const failed = { ...result, ok: false };
    containerFetch.mockResolvedValueOnce(Response.json(failed, { status: 500 }));
    await expect(worker.scheduled(controller, env)).rejects.toThrow("HTTP 500");
    expect(log).toHaveBeenCalledWith("Scheduled forecast result", { status: 500, result: failed });
  });
});
