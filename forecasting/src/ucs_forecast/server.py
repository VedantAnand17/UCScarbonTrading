"""HTTP entrypoint for the Cloudflare forecast container."""

from __future__ import annotations

import json
import logging
import os
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from threading import Lock
from time import monotonic

logger = logging.getLogger(__name__)
_run_lock = Lock()


class ForecastHandler(BaseHTTPRequestHandler):
    def respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.respond(200, {"ok": True})
        else:
            self.respond(404, {"ok": False})

    def do_POST(self) -> None:
        if self.path != "/run":
            self.respond(404, {"ok": False})
            return
        if not _run_lock.acquire(blocking=False):
            self.respond(409, {"ok": False, "devices": [], "durationMs": 0})
            return

        started = monotonic()
        output = StringIO()
        ok = True
        try:
            from .publish import publish_api

            with redirect_stdout(output):
                publish_api(os.environ["FORECAST_API_URL"])
        except Exception:
            logger.exception("Forecast publishing failed")
            ok = False
        finally:
            _run_lock.release()

        self.respond(
            200 if ok else 500,
            {
                "ok": ok,
                "devices": output.getvalue().splitlines(),
                "durationMs": int((monotonic() - started) * 1000),
            },
        )


def create_server(host: str = "0.0.0.0", port: int = 8080) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), ForecastHandler)


if __name__ == "__main__":
    with create_server() as server:
        server.serve_forever()
