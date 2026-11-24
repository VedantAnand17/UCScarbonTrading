import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PlatformRoutes } from "../PlatformRoutes";

const api = "*/api/v1";
const buyer = {
  id: "user-buyer",
  email: "buyer@demo.in",
  name: "Asha Patel",
  roles: ["BUYER"],
  organisationId: "buyer-org",
};
const listing = {
  id: "listing-1",
  sellerOrgName: "Surya Solar",
  remainingG: "20000",
  priceInrPerKg: "2.5",
  createdAt: "2026-11-01T08:00:00.000Z",
};
const server = setupServer(
  http.post(`${api}/auth/login`, () => HttpResponse.json({ token: "demo-token", user: buyer })),
  http.get(`${api}/auth/me`, () => HttpResponse.json(buyer)),
  http.get(`${api}/listings`, () => HttpResponse.json([listing])),
  http.get(`${api}/trades/mine`, () => HttpResponse.json([])),
  http.get(`${api}/generator/summary`, () => HttpResponse.json({
    todayKwh: 12, co2AvoidedTodayKg: 8.52, availableG: "8520", reservedG: "0", devices: [],
  })),
  http.get(`${api}/generator/generation`, () => HttpResponse.json([])),
  http.get(`${api}/generator/forecast`, () => HttpResponse.json([])),
  http.get(`${api}/listings/mine`, () => HttpResponse.json([])),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function visit(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PlatformRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), buyer.email);
  await user.type(screen.getByLabelText("Password"), "demo1234");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("platform access", () => {
  it("signs in to the buyer workspace with only its role links", async () => {
    const user = visit("/");
    await signIn(user);
    expect(await screen.findByRole("heading", { name: "Carbon marketplace" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Marketplace" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Generation" })).not.toBeInTheDocument();
  });

  it("restores a session and denies a direct link outside its roles", async () => {
    sessionStorage.setItem("ucs.platform.token", "demo-token");
    visit("/admin");
    expect(await screen.findByRole("heading", { name: "Access restricted" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to your workspace" })).toHaveAttribute("href", "/buyer");
  });

  it("offers every workspace permitted by a multi-role account", async () => {
    server.use(http.post(`${api}/auth/login`, () => HttpResponse.json({
      token: "multi-token", user: { ...buyer, roles: ["BUYER", "GENERATOR", "ADMIN"] },
    })));
    const user = visit("/generator");
    await signIn(user);
    expect(await screen.findByRole("heading", { name: "Generation dashboard" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Marketplace" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Administration" })).toBeVisible();
  });
});

describe("buying a listing", () => {
  it("explains a 409 and applies the refreshed availability to the amount field", async () => {
    let remainingG = listing.remainingG;
    server.use(
      http.get(`${api}/listings`, () => HttpResponse.json([{ ...listing, remainingG }])),
      http.post(`${api}/trades`, async ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer demo-token");
        expect(await request.json()).toEqual({ listingId: listing.id, amountG: 15000 });
        remainingG = "9000";
        return HttpResponse.json({ error: "Insufficient remaining units" }, { status: 409 });
      }),
    );
    const user = visit("/buyer");
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Buy units" }));
    await user.type(screen.getByLabelText("Amount (kgCO₂e)"), "15");
    await user.click(screen.getByRole("button", { name: "Confirm purchase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Availability changed");
    expect(screen.getByLabelText("Amount (kgCO₂e)")).toHaveValue(15);
    expect(screen.getByRole("button", { name: "Confirm purchase" })).toBeDisabled();
    expect(await screen.findByText("9 kgCO₂e available")).toBeVisible();
  });
});
