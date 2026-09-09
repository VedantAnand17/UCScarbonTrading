// Copy this file to secrets.h (gitignored) and fill in real values.
// Never commit secrets.h.

#pragma once

#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASSWORD "your-wifi-password"

// Backend ingestion endpoint, e.g. "https://api.example.com/api/v1/ingest/reading"
#define INGEST_URL "https://your-backend-host/api/v1/ingest/reading"

// Assigned at admin provisioning time (POST /api/v1/admin/devices/provision).
// Shown exactly once by the backend — copy it here immediately.
#define DEVICE_ID "dev_7f3a2b"
#define DEVICE_SECRET "replace-with-provisioned-per-device-secret"
