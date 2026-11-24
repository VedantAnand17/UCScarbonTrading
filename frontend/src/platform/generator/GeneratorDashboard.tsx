import { BatteryCharging, CircleCheck, Leaf, LockKeyhole, Plus, Radio, SunMedium } from "lucide-react";
import { useAuth, usePlatformQuery } from "../auth";
import { formatCarbon, formatDateTime, formatNumber } from "../format";
import { DevicePill, Empty, Metrics, PageHeading, Panel, QueryContent, TradeList } from "../ui";
import { ForecastChart, GenerationChart } from "./EnergyCharts";
import { ListingControls, MyListings } from "./Listings";
import { useState } from "react";

export function GeneratorDashboard() {
  const { identity } = useAuth();
  const organisation = identity.data?.organisationId;
  const summary = usePlatformQuery("generator-summary", (api, signal) => api.summary(signal));
  const generation = usePlatformQuery("generation", (api, signal) => api.generation(signal));
  const forecast = usePlatformQuery("forecast", (api, signal) => api.forecast(signal));
  const trades = usePlatformQuery("my-trades", (api, signal) => api.myTrades(signal));
  const [listingOpen, setListingOpen] = useState(false);
  const [listingNotice, setListingNotice] = useState("");

  return (
    <div className="dashboard">
      <PageHeading title="Generation dashboard" description="Monitor metered energy and manage the carbon units it generates."
        action={<button className="p-button primary" disabled={!summary.data} onClick={() => {
          setListingNotice(""); setListingOpen(true);
        }}><Plus aria-hidden="true" />Create listing</button>}
      />
      <QueryContent query={summary}>{(data) => (
        <Metrics items={[
          { label: "Generation today", value: `${formatNumber(data.todayKwh)} kWh`, icon: SunMedium },
          { label: "CO₂ avoided today", value: `${formatNumber(data.co2AvoidedTodayKg)} kgCO₂e`, icon: Leaf },
          { label: "Available units", value: formatCarbon(data.availableG), icon: BatteryCharging },
          { label: "Reserved units", value: formatCarbon(data.reservedG), icon: LockKeyhole },
        ]} />
      )}</QueryContent>
      <div className="generation-grid">
        <Panel title="Hourly generation" description="Meter readings from the last 14 days · IST">
          <QueryContent query={generation}>{(data) => <GenerationChart readings={data} />}</QueryContent>
        </Panel>
        <Panel title="Devices" description="Meter status and last reading">
          {summary.data ? (summary.data.devices.length ? (
            <ul className="device-list" role="list">
              {summary.data.devices.map((device) => (
                <li key={device.deviceId}>
                  <span className="record-icon"><Radio aria-hidden="true" /></span>
                  <div><strong>{device.label || device.deviceId}</strong>
                    <span className="record-meta">{device.lastSeenAt ? formatDateTime(device.lastSeenAt) : "No readings yet"}</span>
                  </div>
                  <DevicePill status={device.status} />
                </li>
              ))}
            </ul>
          ) : <Empty>No meters have been provisioned for this organisation.</Empty>) : summary.isPending
            ? <QueryContent query={summary}>{() => null}</QueryContent> : <p className="quiet">Meter status is temporarily unavailable.</p>}
        </Panel>
      </div>
      <Panel title="Generation forecast" description="Upcoming generation and recent metered actuals · IST">
        <QueryContent query={forecast}>{(data) => (
          <ForecastChart forecasts={data} readings={generation.data ?? []} devices={summary.data?.devices ?? []} />
        )}</QueryContent>
      </Panel>
      <div className="dashboard-columns">
        <Panel title="My listings" description="Units you have reserved for sale.">
          {listingNotice && <div className="notice notice-good" role="status"><CircleCheck aria-hidden="true" />{listingNotice}</div>}
          <MyListings />
        </Panel>
        <Panel title="Recent trades" description="Settled sales and their anchor progress.">
          <QueryContent query={trades}>{(items) => (
            <TradeList trades={items.filter((trade) => trade.sellerOrgId === organisation).slice(0, 8)}
              organisationId={organisation} empty="Settled sales will appear here when buyers purchase your units." />
          )}</QueryContent>
        </Panel>
      </div>
      {listingOpen && <ListingControls availableG={summary.data?.availableG ?? 0}
        close={() => setListingOpen(false)}
        onCreated={() => { setListingOpen(false); setListingNotice("Listing created. Its units are now reserved."); }}
      />}
    </div>
  );
}
