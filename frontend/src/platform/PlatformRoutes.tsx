import { lazy, Suspense } from "react";
import { AdminDashboard } from "./admin/AdminDashboard";
import { BuyerDashboard } from "./BuyerDashboard";
import { Login } from "./Login";
import { TradeDetail } from "./TradeDetail";
import { AuthProvider, useAuth } from "./auth";
import { ArrowRight, ExternalLink, Gauge, Leaf, LogOut, ShieldCheck, Store } from "lucide-react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Role, User } from "./types";
import { Loading, QueryContent } from "./ui";
import "./platform.css";

const GeneratorDashboard = lazy(async () => ({
  default: (await import("./generator/GeneratorDashboard")).GeneratorDashboard,
}));

const workspaces = [
  { role: "GENERATOR", to: "/generator", label: "Generation", icon: Gauge },
  { role: "BUYER", to: "/buyer", label: "Marketplace", icon: Store },
  { role: "ADMIN", to: "/admin", label: "Administration", icon: ShieldCheck },
] as const;

const workspaceHome = (user: User) => workspaces.find(({ role }) => user.roles.includes(role))?.to;

function SignInRoute() {
  const { token, identity } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (token && identity.isPending) return <Loading label="Restoring session" />;
  if (token && identity.data) return <Navigate to={from || "/"} replace />;
  return <Login />;
}

function SignedIn() {
  const { token, identity, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }
  if (!token) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;

  if (!identity.data) {
    return (
      <main className="session-screen">
        <QueryContent query={identity}>{() => null}</QueryContent>
        {identity.isError && <button className="p-button secondary" onClick={signOut}>Sign out</button>}
      </main>
    );
  }

  const { data: user } = identity;
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
  return (
    <div className="workspace">
      <a className="skip-link" href="#workspace-main">Skip to content</a>
      <header className="workspace-header">
        <Link className="platform-brand" to="/">
          <span className="brand-icon"><Leaf aria-hidden="true" /></span>
          <span>UCS Carbon<span className="brand-subtitle">Trading platform</span></span>
        </Link>
        <div className="account">
          {import.meta.env.VITE_MOCK_API === "true" && <span className="demo-label">Demo workspace</span>}
          <span className="account-avatar" aria-hidden="true">{initials}</span>
          <span className="account-name">{user.name}</span>
          <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={signOut}>
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </header>
      <aside className="workspace-sidebar">
        <nav aria-label="Workspace">
          {workspaces.filter(({ role }) => user.roles.includes(role)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}><Icon aria-hidden="true" />{label}</NavLink>
          ))}
          <Link className="on-chain-link" to="/on-chain"><ExternalLink aria-hidden="true" />On-chain tools</Link>
        </nav>
        <div className="sidebar-footer">UCS Carbon Trading</div>
      </aside>
      <main id="workspace-main" className="workspace-main" tabIndex={-1}><Outlet /></main>
    </div>
  );
}

function Home() {
  const { identity } = useAuth();
  const to = identity.data && workspaceHome(identity.data);
  return to ? <Navigate to={to} replace /> : <AccessRestricted />;
}

function AccessRestricted() {
  const { identity, logout } = useAuth();
  const to = identity.data && workspaceHome(identity.data);
  return (
    <div className="access-state">
      <ShieldCheck aria-hidden="true" />
      <h1>Access restricted</h1>
      <p>Your account does not have permission to open this workspace.</p>
      {to ? <Link className="p-button primary" to={to}>Go to your workspace <ArrowRight aria-hidden="true" /></Link>
        : <button onClick={logout} className="p-button secondary">Sign out</button>}
    </div>
  );
}

function RequireRole({ role }: { role: Role }) {
  const { identity } = useAuth();
  return identity.data?.roles.includes(role) ? <Outlet /> : <AccessRestricted />;
}

export function PlatformRoutes() {
  return (
    <div className="platform">
      <AuthProvider>
        <Routes>
          <Route path="login" element={<SignInRoute />} />
          <Route element={<SignedIn />}>
            <Route index element={<Home />} />
            <Route element={<RequireRole role="GENERATOR" />}>
              <Route path="generator" element={<Suspense fallback={<Loading />}><GeneratorDashboard /></Suspense>} />
            </Route>
            <Route element={<RequireRole role="BUYER" />}>
              <Route path="buyer" element={<BuyerDashboard />} />
            </Route>
            <Route element={<RequireRole role="ADMIN" />}>
              <Route path="admin" element={<AdminDashboard />} />
            </Route>
            <Route path="trades/:id" element={<TradeDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </div>
  );
}
