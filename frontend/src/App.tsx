import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { PlatformRoutes } from "./platform/PlatformRoutes";

const OnChainApp = lazy(() => import("./OnChainApp"));

function LegacyOnChainRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/on-chain${pathname}${search}${hash}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="on-chain/*" element={
        <Suspense fallback={<main className="route-loading" role="status">Loading on-chain tools…</main>}>
          <OnChainApp />
        </Suspense>
      } />
      <Route path="projects/*" element={<LegacyOnChainRedirect />} />
      <Route path="marketplace" element={<LegacyOnChainRedirect />} />
      <Route path="portfolio" element={<LegacyOnChainRedirect />} />
      <Route path="*" element={<PlatformRoutes />} />
    </Routes>
  );
}
