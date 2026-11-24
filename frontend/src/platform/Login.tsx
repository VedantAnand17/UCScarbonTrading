import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Leaf, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createApi } from "./api";
import { useAuth } from "./auth";
import { InlineError } from "./ui";

const publicApi = createApi();
const demoAccounts = [
  ["Generation", "generator@demo.in"],
  ["Marketplace", "buyer@demo.in"],
  ["Administration", "admin@demo.in"],
];

export function Login() {
  const { acceptSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      publicApi.login(credentials.email, credentials.password),
    onSuccess: acceptSession,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!login.isPending) login.mutate({ email: email.trim(), password });
  }

  return (
    <div className="login-page">
      <header className="login-top">
        <Link className="platform-brand" to="/">
          <span className="brand-icon"><Leaf aria-hidden="true" /></span>
          <span>UCS Carbon<span className="brand-subtitle">Trading platform</span></span>
        </Link>
        <Link className="text-link" to="/on-chain">On-chain tools <ArrowRight aria-hidden="true" /></Link>
      </header>
      <main className="login-main">
        <div className="login-intro">
          <span className="login-illustration" aria-hidden="true"><Leaf /></span>
          <p>From metered energy<br />to auditable trades.</p>
          <div>Track generation, trade carbon units, and verify settlement on Ethereum Sepolia.</div>
        </div>
        <div className="login-form-wrap">
          <form className="platform-form login-form" onSubmit={submit}>
            <LockKeyhole className="login-lock" aria-hidden="true" />
            <div><h1>Sign in</h1><p>Access your UCS Carbon workspace.</p></div>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {login.isError && <InlineError error={login.error} />}
            <button className="p-button primary" type="submit" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"} <ArrowRight aria-hidden="true" />
            </button>
          </form>
          {import.meta.env.VITE_MOCK_API === "true" && (
            <div className="demo-accounts">
              <p>Sample data · Fill a demo login</p>
              <div>
                {demoAccounts.map(([label, account]) => (
                  <button type="button" className="p-button secondary" key={account} onClick={() => {
                    setEmail(account);
                    setPassword("demo1234");
                    login.reset();
                  }}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
