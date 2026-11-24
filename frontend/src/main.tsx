import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./platform/api";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});
const root = ReactDOM.createRoot(document.getElementById("root")!);

async function start() {
  if (import.meta.env.VITE_MOCK_API === "true") {
    const { worker } = await import("./platform/mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass", quiet: true });
  }

  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void start().catch((error: unknown) => {
  console.error(error);
  root.render(
    <main className="route-loading" role="alert">
      Could not start the mock API. Reload the page or run without VITE_MOCK_API.
    </main>,
  );
});
