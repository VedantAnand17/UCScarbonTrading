import { Navigate, Routes, Route } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { Toaster } from "react-hot-toast";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Marketplace from "./pages/Marketplace";
import Portfolio from "./pages/Portfolio";
import Admin from "./pages/Admin";
import { wagmiConfig } from "./lib/wagmi";

const theme = darkTheme({
  accentColor: "#1fbd62",
  accentColorForeground: "#031b0f",
  borderRadius: "medium",
  overlayBlur: "small",
});

export default function OnChainApp() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={theme}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="marketplace" element={<Marketplace />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/on-chain" replace />} />
          </Route>
        </Routes>
        <Toaster position="bottom-right" toastOptions={{
          style: { background: "#0f172a", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.08)" },
        }} />
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
