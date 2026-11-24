import { Link, NavLink, Outlet } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Leaf, Recycle, Store, FolderKanban, Wallet, Settings } from "lucide-react";
import { useIsOwner } from "@/hooks/useIsOwner";

const navItems = [
  { to: "/on-chain", label: "Buy & spend", icon: Recycle, end: true },
  { to: "/on-chain/marketplace", label: "Market", icon: Store },
  { to: "/on-chain/projects", label: "Projects", icon: FolderKanban },
  { to: "/on-chain/portfolio", label: "My credits", icon: Wallet },
];

export default function Layout() {
  const { isOwner } = useIsOwner();

  return (
    <div className="on-chain min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/on-chain" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf-500/15 ring-1 ring-leaf-500/30">
              <Leaf className="h-4 w-4 text-leaf-400" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-white">UCS Carbon</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                buy · sell · spend carbon credits
              </div>
            </div>
          </Link>

          <nav className="order-last flex w-full flex-wrap items-center gap-1 lg:order-none lg:w-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-white",
                  ].join(" ")
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
            {isOwner && (
              <NavLink
                to="/on-chain/admin"
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-leaf-500/15 text-leaf-200 ring-1 ring-leaf-500/30"
                      : "text-leaf-300/80 hover:bg-leaf-500/10 hover:text-leaf-200",
                  ].join(" ")
                }
              >
                <Settings className="h-4 w-4" />
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-leaf-300 hover:text-white">Platform</Link>
            <ConnectButton chainStatus="icon" accountStatus="address" showBalance={false} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-slate-500">
        Runs on Ethereum · 1 credit = 1 tonne of CO₂ · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
