import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth, usePlatformQuery, useRefresh } from "../auth";
import { Dialog } from "../Dialog";
import { formatDate } from "../format";
import type { EmissionFactor } from "../types";
import { Empty, InlineError, Panel, QueryContent } from "../ui";

export function EmissionFactors() {
  const { api } = useAuth();
  const refresh = useRefresh();
  const factors = usePlatformQuery("emission-factors", (client, signal) => client.factors(signal));
  const [creating, setCreating] = useState(false);
  const [invalidRange, setInvalidRange] = useState(false);
  const create = useMutation({
    mutationFn: (body: Omit<EmissionFactor, "id">) => api.createFactor(body),
    onSuccess: async () => { await refresh("emission-factors"); setCreating(false); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    const values = new FormData(event.currentTarget);
    const validFrom = String(values.get("validFrom"));
    const validTo = String(values.get("validTo"));
    const invalid = Boolean(validTo && validTo <= validFrom);
    setInvalidRange(invalid);
    if (invalid) return;
    create.mutate({
      version: String(values.get("version")).trim(),
      kgPerKwh: Number(values.get("kgPerKwh")),
      source: String(values.get("source")).trim(),
      validFrom: new Date(validFrom).toISOString(),
      ...(validTo ? { validTo: new Date(validTo).toISOString() } : {}),
    });
  }

  return (
    <Panel title="Emission factors" description="Versioned conversion rates for metered electricity."
      action={<button className="p-button secondary" onClick={() => {
        create.reset(); setInvalidRange(false); setCreating(true);
      }}><Plus aria-hidden="true" />Add version</button>}>
      <QueryContent query={factors}>{(data) => data.length ? (
        <ul className="listing-list" role="list">
          {data.map((factor) => (
            <li key={factor.id}>
              <div><strong>{factor.version}</strong><span className="record-meta">{factor.source}</span>
                <span className="record-meta">{formatDate(factor.validFrom)} {factor.validTo ? `to ${formatDate(factor.validTo)}` : "onward"}</span>
              </div>
              <span className="numeric factor-value">{factor.kgPerKwh} kgCO₂e/kWh</span>
            </li>
          ))}
        </ul>
      ) : <Empty>Add an emission factor to define the carbon conversion rate.</Empty>}</QueryContent>
      {creating && (
        <Dialog title="Add emission factor" close={() => setCreating(false)} busy={create.isPending}>
          <form className="platform-form" onSubmit={submit} onChange={() => setInvalidRange(false)}>
            <label>Version<input name="version" required /></label>
            <label>Emission factor (kgCO₂e/kWh)<input name="kgPerKwh" type="number" min="0.000001" step="any" required /></label>
            <label>Source<input name="source" required /></label>
            <div className="form-columns">
              <label>Valid from<input type="date" name="validFrom" required /></label>
              <label>Valid to (optional)<input type="date" name="validTo" /></label>
            </div>
            {invalidRange && <InlineError>Valid to must be later than valid from.</InlineError>}
            {create.error && <InlineError error={create.error} />}
            <div className="dialog-actions">
              <button type="button" className="p-button secondary" onClick={() => setCreating(false)} disabled={create.isPending}>Cancel</button>
              <button type="submit" className="p-button primary" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Save factor"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </Panel>
  );
}
