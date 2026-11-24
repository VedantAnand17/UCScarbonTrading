FROM ghcr.io/astral-sh/uv:0.13.9 AS uv
FROM python:3.13-slim-bookworm AS build

COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /build
COPY forecasting/pyproject.toml forecasting/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY forecasting/src ./src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.13-slim-bookworm

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1
COPY --from=build /opt/venv /opt/venv
RUN groupadd --system forecast && useradd --system --gid forecast forecast
USER forecast
EXPOSE 8080
CMD ["python", "-m", "ucs_forecast.server"]
