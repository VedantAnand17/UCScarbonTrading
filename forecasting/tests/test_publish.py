import json
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from ucs_forecast import publish


def test_publish_through_worker_api(monkeypatch):
    start = int(datetime(2026, 11, 1, tzinfo=UTC).timestamp())
    generated = []

    class Worker(BaseHTTPRequestHandler):
        def respond(self, payload, status=200):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())

        def do_GET(self):
            assert self.headers["Authorization"] == "Bearer forecast-token"
            if self.path == "/api/v1/admin/devices":
                self.respond(
                    [
                        {"deviceId": "active", "status": "active"},
                        {"deviceId": "retired", "status": "revoked"},
                    ]
                )
            elif self.path in (
                "/api/v1/admin/readings?deviceId=active",
                "/api/v1/admin/readings?deviceId=active&cursor=page2",
            ):
                next_page = "cursor" in self.path
                self.respond(
                    {
                        "readings": [
                            {
                                "deviceTimestamp": start + hour * 3600,
                                "kwhInterval": float(6 <= hour % 24 < 18),
                            }
                            for hour in range(60 * next_page, 60 * (next_page + 1))
                        ],
                        "nextCursor": None if next_page else "page2",
                    }
                )
            else:
                self.respond({"error": "not found"}, 404)

        def do_POST(self):
            assert self.path == "/api/v1/admin/forecasts"
            assert self.headers["Authorization"] == "Bearer forecast-token"
            generated.extend(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))["rows"]
            )
            self.respond({"stored": 1}, 201)

    monkeypatch.setenv("FORECAST_API_TOKEN", "forecast-token")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with ThreadingHTTPServer(("127.0.0.1", 0), Worker) as server:
        thread = Thread(target=server.serve_forever)
        thread.start()
        try:
            publish.main(["--api", f"http://127.0.0.1:{server.server_port}/api/v1"])
        finally:
            server.shutdown()
            thread.join()
    (forecast,) = generated
    assert forecast["deviceId"] == "active"
    assert forecast["horizonHours"] == len(forecast["energyKwh"]) == 24
    assert forecast["unitsExpectedG"] == "8520"
    assert datetime.fromisoformat(forecast["horizonStart"]).tzinfo is not None
