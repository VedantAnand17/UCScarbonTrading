import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createApi } from "./api";
import type { Session } from "./types";

const tokenKey = "ucs.platform.token";
type Api = ReturnType<typeof createApi>;

function usePlatformSession() {
  const client = useQueryClient();
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey));

  const logout = useCallback(() => {
    sessionStorage.removeItem(tokenKey);
    setToken(null);
    client.removeQueries({ queryKey: ["platform"] });
  }, [client]);

  const api = useMemo(() => createApi(token ?? undefined, () => {
    if (token && sessionStorage.getItem(tokenKey) === token) logout();
  }), [token, logout]);
  const identity = useQuery({
    queryKey: ["platform", token, "identity"],
    queryFn: ({ signal }) => api.me(signal),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

  function acceptSession(session: Session) {
    client.removeQueries({ queryKey: ["platform"] });
    client.setQueryData(["platform", session.token, "identity"], session.user);
    sessionStorage.setItem(tokenKey, session.token);
    setToken(session.token);
  }

  return { api, token, identity, acceptSession, logout };
}

const Auth = createContext<ReturnType<typeof usePlatformSession> | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = usePlatformSession();
  return <Auth.Provider value={session}>{children}</Auth.Provider>;
}

export function useAuth() {
  const auth = useContext(Auth);
  if (!auth) throw new Error("Platform auth context is missing");
  return auth;
}

export function usePlatformQuery<T>(name: string, operation: (api: Api, signal: AbortSignal) => Promise<T>) {
  const { api, token } = useAuth();
  return useQuery({
    queryKey: ["platform", token, name],
    queryFn: ({ signal }) => operation(api, signal),
  });
}

export function useRefresh() {
  const client = useQueryClient();
  const { token } = useAuth();
  return (...queries: string[]) => Promise.all(queries.map((name) =>
    client.invalidateQueries({ queryKey: ["platform", token, name] }),
  ));
}
