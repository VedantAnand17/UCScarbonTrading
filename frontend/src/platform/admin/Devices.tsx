import { useMutation } from "@tanstack/react-query";
import { Plus, Radio } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth, usePlatformQuery, useRefresh } from "../auth";
import { Dialog } from "../Dialog";
import { formatNumber } from "../format";
import type { AdminDevice, ProvisionDevice } from "../types";
import { DevicePill, Empty, InlineError, Panel, QueryContent } from "../ui";

function Provision({ close }: { close: () => void }) {
  const { api } = useAuth();
  const refresh = useRefresh();
  const provision = useMutation({
    mutationFn: (body: ProvisionDevice) => api.provision(body),
    gcTime: 0,
    onSuccess: () => { void refresh("admin-devices", "admin-overview", "generator-summary"); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (provision.isPending) return;
    const fields = new FormData(event.currentTarget);
    provision.mutate({
      label: String(fields.get("label")).trim(),
      organisationId: String(fields.get("organisationId")).trim(),
      ratedCapacityKw: Number(fields.get("ratedCapacityKw")),
    });
  }

  return (
    <Dialog title={provision.data ? "Device provisioned" : "Provision a device"} close={close} busy={provision.isPending}>
      {provision.data ? (
        <div className="platform-form">
          <p>Save this secret before closing. It is shown only once and is required by the meter firmware.</p>
          <label>Device ID<input readOnly value={provision.data.device_id} onFocus={(event) => event.target.select()} /></label>
          <label>Device secret<input className="numeric" readOnly value={provision.data.device_secret}
            onFocus={(event) => event.target.select()} /></label>
          <div className="dialog-actions"><button className="p-button primary" onClick={close}>Done</button></div>
        </div>
      ) : (
        <form className="platform-form" onSubmit={submit}>
          <label>Device label<input name="label" required /></label>
          <label>Organisation ID<input name="organisationId" required /></label>
          <label>Rated capacity (kW)<input name="ratedCapacityKw" type="number" min="0.001" step="any" required /></label>
          {provision.error && <InlineError error={provision.error} />}
          <div className="dialog-actions">
            <button type="button" className="p-button secondary" disabled={provision.isPending} onClick={close}>Cancel</button>
            <button type="submit" className="p-button primary" disabled={provision.isPending}>
              {provision.isPending ? "Provisioning…" : "Provision device"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function AdminDevices() {
  const { api } = useAuth();
  const refresh = useRefresh();
  const devices = usePlatformQuery("admin-devices", (client, signal) => client.devices(signal));
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AdminDevice>();
  const revoke = useMutation({
    mutationFn: (id: string) => api.revoke(id),
    onSuccess: async () => { await refresh("admin-devices", "admin-overview", "generator-summary"); setRevoking(undefined); },
  });

  return (
    <Panel title="Devices" description="Manage metering credentials."
      action={<button className="p-button secondary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />Provision device</button>}>
      <QueryContent query={devices}>{(data) => data.length ? (
        <ul className="listing-list" role="list">
          {data.map((device) => (
            <li key={device.deviceId}>
              <div className="record-name">
                <span className="record-icon"><Radio aria-hidden="true" /></span>
                <div>
                  <strong>{device.label || device.deviceId}</strong> <DevicePill status={device.status} />
                  <span className="record-meta">{device.deviceId} · {formatNumber(device.ratedCapacityKw)} kW</span>
                  {device.organisationId && <span className="record-meta">Org {device.organisationId}</span>}
                </div>
              </div>
              {device.status.toLowerCase() !== "revoked" && <button className="p-button secondary" onClick={() => {
                revoke.reset(); setRevoking(device);
              }}>Revoke</button>}
            </li>
          ))}
        </ul>
      ) : <Empty>Provision a device to issue credentials for a meter.</Empty>}</QueryContent>
      {creating && <Provision close={() => setCreating(false)} />}
      {revoking && (
        <Dialog title="Revoke device?" close={() => setRevoking(undefined)} busy={revoke.isPending}>
          <div className="platform-form">
            <p>{revoking.label || revoking.deviceId} will no longer be able to submit readings with its current credentials.</p>
            {revoke.error && <InlineError error={revoke.error} />}
            <div className="dialog-actions">
              <button className="p-button secondary" onClick={() => setRevoking(undefined)} disabled={revoke.isPending}>Keep device</button>
              <button className="p-button danger" onClick={() => revoke.mutate(revoking.deviceId)} disabled={revoke.isPending}>
                {revoke.isPending ? "Revoking…" : "Revoke device"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
