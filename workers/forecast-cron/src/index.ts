import { Container, getContainer } from "@cloudflare/containers";
import { createHash, timingSafeEqual } from "node:crypto";

interface Env {
  FORECAST_CONTAINER: DurableObjectNamespace<ForecastContainer>;
  FORECAST_API_URL: string;
  FORECAST_API_EMAIL: string;
  FORECAST_API_PASSWORD: string;
  CRON_TRIGGER_TOKEN?: string;
}

export class ForecastContainer extends Container<Env> {
  defaultPort = 8080;
  pingEndpoint = "container/health";
  sleepAfter = "5m";
  envVars = {
    FORECAST_API_URL: this.env.FORECAST_API_URL,
    FORECAST_API_EMAIL: this.env.FORECAST_API_EMAIL,
    FORECAST_API_PASSWORD: this.env.FORECAST_API_PASSWORD,
  };
}

function authorized(header: string | null, secret: string | undefined): boolean {
  const token = header?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || !secret) return false;

  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(token), digest(secret));
}

function runForecast(env: Env): Promise<Response> {
  return getContainer(env.FORECAST_CONTAINER, "nightly").fetch("http://container/run", { method: "POST" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/run") {
      return Response.json({ ok: false }, { status: 404 });
    }
    if (!authorized(request.headers.get("Authorization"), env.CRON_TRIGGER_TOKEN)) {
      return Response.json({ ok: false }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }

    try {
      const response = await runForecast(env);
      if (response.headers.get("Content-Type")?.startsWith("application/json")) return response;
      console.error("Unexpected forecast container response", response.status);
      await response.body?.cancel();
    } catch (error) {
      console.error("Could not reach forecast container", error);
    }
    return Response.json({ ok: false }, { status: 502 });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const response = await runForecast(env);
    const result = await response.json<{ ok: boolean }>().catch(() => null);
    console.log("Scheduled forecast result", { status: response.status, result });
    if (!response.ok || !result?.ok) throw new Error(`Forecast run failed (HTTP ${response.status})`);
  },
} satisfies ExportedHandler<Env>;
