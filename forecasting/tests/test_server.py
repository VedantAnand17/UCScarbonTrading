import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from threading import Event, Thread

import pytest

from ucs_forecast import publish, server


@pytest.fixture
def request_forecast():
    with server.create_server("127.0.0.1", 0) as httpd:
        thread = Thread(target=httpd.serve_forever)
        thread.start()

        def request(method, path):
            connection = HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
            try:
                connection.request(method, path)
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        try:
            yield request
        finally:
            httpd.shutdown()
            thread.join()


def test_health_does_not_need_api_url(request_forecast, monkeypatch):
    monkeypatch.delenv("FORECAST_API_URL", raising=False)
    assert request_forecast("GET", "/health") == (200, {"ok": True})


def test_server_import_does_not_load_forecast_models():
    subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; from ucs_forecast import server; "
                'assert "ucs_forecast.models" not in sys.modules'
            ),
        ],
        check=True,
    )


def test_run_publishes_and_returns_device_lines(request_forecast, monkeypatch):
    monkeypatch.setenv("FORECAST_API_URL", "https://forecast.example")
    calls = []

    def fake_publish(url):
        calls.append(url)
        print("meter-one: seasonal_naive_24h")
        print("meter-two: sarima")

    monkeypatch.setattr(publish, "publish_api", fake_publish)
    status, result = request_forecast("POST", "/run")
    assert calls == ["https://forecast.example"]
    assert status == 200
    assert result == {
        "ok": True,
        "devices": ["meter-one: seasonal_naive_24h", "meter-two: sarima"],
        "durationMs": result["durationMs"],
    }
    assert isinstance(result["durationMs"], int) and result["durationMs"] >= 0


def test_run_returns_failure_with_partial_results(request_forecast, monkeypatch):
    monkeypatch.setenv("FORECAST_API_URL", "https://forecast.example")

    def fake_publish(url):
        print("first meter published")
        raise RuntimeError("internal detail")

    monkeypatch.setattr(publish, "publish_api", fake_publish)
    status, result = request_forecast("POST", "/run")
    assert status == 500
    assert result == {
        "ok": False,
        "devices": ["first meter published"],
        "durationMs": result["durationMs"],
    }


def test_run_rejects_overlap_while_health_stays_available(request_forecast, monkeypatch):
    monkeypatch.setenv("FORECAST_API_URL", "https://forecast.example")
    started = Event()
    release = Event()

    def fake_publish(url):
        started.set()
        assert release.wait(5)

    monkeypatch.setattr(publish, "publish_api", fake_publish)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(request_forecast, "POST", "/run")
        try:
            assert started.wait(5)
            assert request_forecast("GET", "/health")[0] == 200
            assert request_forecast("POST", "/run")[0] == 409
        finally:
            release.set()
        assert first.result()[0] == 200


@pytest.mark.parametrize(("method", "path"), [("GET", "/run"), ("POST", "/anything")])
def test_unknown_routes_return_not_found(request_forecast, method, path):
    assert request_forecast(method, path)[0] == 404
