#include <Arduino.h>
#include <ModbusMaster.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <mbedtls/md.h>

// -----------------------------------------------------
// TEMP TEST SECRETS — inlined for local bench testing against the
// real backend/ (backend/src/index.js). Replace with the real
// "#include secrets.h" (see secrets.example.h) before this ever
// touches a real deployment. Do not commit real credentials here.
// -----------------------------------------------------
#define WIFI_SSID "OnePlus"
#define WIFI_PASSWORD "Nishesh16"

// Point at your machine's LAN IP running backend/ (npm run dev, port 4000).
// Find it with `ipconfig` (look for the WiFi adapter's IPv4 address) —
// the ESP32 can't reach "localhost", it needs your actual LAN IP.
#define INGEST_URL "http://10.236.116.178:4000/api/v1/ingest/reading"

// Provisioned via POST /api/v1/admin/devices/provision — ratedCapacityKw
// set to 2.3 (230V x 10A basic meter range) since this device's actual
// generation source rating isn't known yet.
#define DEVICE_ID "dev_2153d2a1"
#define DEVICE_SECRET "0c029fa8fb5aff37a1784f30cbbc7ea154fa82281ae5a1819284ff9620db8923"

// =====================================================
// ESP32 <-> RS485 CONNECTION
// =====================================================
// RS485 RO  -> ESP32 GPIO16 (RX2)
// RS485 DI  -> ESP32 GPIO17 (TX2)
// RS485 DE  -> ESP32 GPIO4
// RS485 RE  -> ESP32 GPIO4
// RS485 GND -> ESP32 GND
//
// Selec EM2M:
// Terminal 4 (+) -> RS485 A / +
// Terminal 5 (-) -> RS485 B / -
//
// Meter:
// Modbus Slave ID = 1
// Baud rate       = 9600
// Serial format   = 8N1
// =====================================================

#define RS485_DE_RE 4
#define RS485_RX 16
#define RS485_TX 17

#define METER_ID 1
#define METER_BAUD 9600

// Reporting interval between complete measurement + submit cycles.
// PRD default: 5 minutes. TEMP: shortened to 20s for bench testing —
// restore (5UL * 60UL * 1000UL) before field deployment.
#define REPORT_INTERVAL_MS (20UL * 1000UL)

// Bounded ring buffer of readings pending transmission. Sized so a
// backend/WiFi outage of ~REPORT_INTERVAL_MS * RING_BUFFER_SIZE can be
// absorbed without dropping data.
#define RING_BUFFER_SIZE 64

// Non-blocking network attempts: never let a slow/dead backend stall the
// Modbus polling loop. Each flush attempt gets a hard timeout, and Wi-Fi
// connect is checked opportunistically rather than blocked on.
#define WIFI_CONNECT_TIMEOUT_MS 8000
#define HTTP_TIMEOUT_MS 5000
#define NTP_SYNC_TIMEOUT_MS 5000

ModbusMaster meter;
Preferences prefs;

// -----------------------------------------------------
// Pending reading + ring buffer
// -----------------------------------------------------

struct Reading
{
    uint32_t seq;
    uint32_t timestamp; // unix time (best-effort; seq is authoritative ordering)
    float kwhCumulative;
    float kwhInterval;
};

Reading ringBuffer[RING_BUFFER_SIZE];
uint16_t ringHead = 0; // next slot to write
uint16_t ringTail = 0; // next slot to send
uint16_t ringCount = 0;

bool ringPush(const Reading &r)
{
    if (ringCount == RING_BUFFER_SIZE)
    {
        // Buffer full: drop the oldest reading to make room for the
        // newest. Cumulative readings are self-healing, so losing an old
        // interval sample is preferable to blocking data collection.
        ringTail = (ringTail + 1) % RING_BUFFER_SIZE;
        ringCount--;
        Serial.println("WARN: ring buffer full, dropping oldest reading");
    }

    ringBuffer[ringHead] = r;
    ringHead = (ringHead + 1) % RING_BUFFER_SIZE;
    ringCount++;
    return true;
}

bool ringPeek(Reading &out)
{
    if (ringCount == 0)
        return false;
    out = ringBuffer[ringTail];
    return true;
}

void ringPop()
{
    if (ringCount == 0)
        return;
    ringTail = (ringTail + 1) % RING_BUFFER_SIZE;
    ringCount--;
}

// -----------------------------------------------------
// Persisted monotonic seq (must survive reboot — the
// backend rejects any seq <= last accepted for this device)
// -----------------------------------------------------

uint32_t nextSeq = 1;

void loadSeq()
{
    prefs.begin("ingest", false);
    nextSeq = prefs.getUInt("next_seq", 1);
}

void saveSeq()
{
    prefs.putUInt("next_seq", nextSeq);
}

// -----------------------------------------------------
// RS485 direction control
// -----------------------------------------------------

void preTransmission()
{
    digitalWrite(RS485_DE_RE, HIGH);
}

void postTransmission()
{
    digitalWrite(RS485_DE_RE, LOW);
}

// -----------------------------------------------------
// Convert two 16-bit Modbus registers into float
//
// Your working tests showed that this word ordering
// produces the meaningful meter values.
// -----------------------------------------------------

float registersToFloat(uint16_t reg0, uint16_t reg1)
{
    uint32_t combined =
        ((uint32_t)reg1 << 16) | reg0;

    float value;

    memcpy(&value, &combined, sizeof(value));

    return value;
}

// -----------------------------------------------------
// Read one 32-bit floating-point value
// -----------------------------------------------------

bool readFloatRegister(uint16_t address, float &value)
{
    const uint8_t MAX_RETRIES = 3;

    for (uint8_t attempt = 0; attempt < MAX_RETRIES; attempt++)
    {
        uint8_t result =
            meter.readInputRegisters(address, 2);

        if (result == meter.ku8MBSuccess)
        {
            uint16_t reg0 = meter.getResponseBuffer(0);
            uint16_t reg1 = meter.getResponseBuffer(1);

            value = registersToFloat(reg0, reg1);

            return true;
        }

        // Give the meter some time before retrying
        delay(100);
    }

    return false;
}

// -----------------------------------------------------
// Print a read failure
// -----------------------------------------------------

void printReadError(const char *parameter)
{
    Serial.print("ERROR: Could not read ");
    Serial.println(parameter);
}

// -----------------------------------------------------
// Canonical payload serialization + HMAC-SHA256
//
// Canonical form (fixed field order, fixed decimal precision,
// no surrounding whitespace) — MUST match the backend's
// verification exactly, or every signature will fail to verify:
//
//   device_id|seq|timestamp|kwh_cumulative|kwh_interval
//
// Floats are formatted with 6 decimal places to remove any
// ambiguity from platform-dependent float-to-string conversion.
// -----------------------------------------------------

String canonicalPayload(const Reading &r)
{
    char buf[192];
    snprintf(buf, sizeof(buf), "%s|%lu|%lu|%.6f|%.6f",
              DEVICE_ID,
              (unsigned long)r.seq,
              (unsigned long)r.timestamp,
              r.kwhCumulative,
              r.kwhInterval);
    return String(buf);
}

String hmacHex(const String &message, const char *key)
{
    byte hmacResult[32];

    mbedtls_md_context_t ctx;
    mbedtls_md_type_t mdType = MBEDTLS_MD_SHA256;

    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(mdType), 1 /* hmac */);
    mbedtls_md_hmac_starts(&ctx, (const unsigned char *)key, strlen(key));
    mbedtls_md_hmac_update(&ctx, (const unsigned char *)message.c_str(), message.length());
    mbedtls_md_hmac_finish(&ctx, hmacResult);
    mbedtls_md_free(&ctx);

    char hex[65];
    for (int i = 0; i < 32; i++)
    {
        sprintf(hex + (i * 2), "%02x", hmacResult[i]);
    }
    hex[64] = '\0';

    return String(hex);
}

// -----------------------------------------------------
// Wi-Fi: connect opportunistically, never block forever
// -----------------------------------------------------

void ensureWifiConnected()
{
    if (WiFi.status() == WL_CONNECTED)
        return;

    Serial.println("WiFi: connecting...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           (millis() - start) < WIFI_CONNECT_TIMEOUT_MS)
    {
        delay(200);
    }

    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.print("WiFi: connected, IP ");
        Serial.println(WiFi.localIP());
    }
    else
    {
        Serial.println("WiFi: connect timed out, will retry later");
    }
}

// -----------------------------------------------------
// Sync wall-clock time over NTP. Reading.timestamp must be a real
// Unix time (backend rejects readings whose timestamp is outside a
// skew window of server time) — without this, time(nullptr) just
// returns seconds-since-boot, not seconds-since-epoch.
//
// Best-effort with a bounded wait: if WiFi isn't connected or NTP
// doesn't respond in time, proceeds anyway rather than blocking
// setup() forever. flushPending() calls this again each cycle, which
// is a no-op once synced but retries if the boot-time attempt failed.
// -----------------------------------------------------

bool timeIsSynced()
{
    // Before a successful sync, time(nullptr) is small (seconds since
    // boot). Any real Unix time is well past 2020-01-01 (1577836800).
    return time(nullptr) > 1577836800;
}

void syncTime()
{
    if (WiFi.status() != WL_CONNECTED)
        return;

    if (timeIsSynced())
        return;

    Serial.println("Time: syncing via NTP...");
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");

    unsigned long start = millis();
    while (!timeIsSynced() && (millis() - start) < NTP_SYNC_TIMEOUT_MS)
    {
        delay(200);
    }

    if (timeIsSynced())
    {
        Serial.print("Time: synced, unix time ");
        Serial.println((unsigned long)time(nullptr));
    }
    else
    {
        Serial.println("Time: NTP sync timed out, will retry later");
    }
}

// -----------------------------------------------------
// POST one reading. Returns true only on a definitive
// success (200) or definitive duplicate (409) — both mean
// the reading is safe to drop from the buffer. Any other
// outcome (network error, 5xx, timeout) leaves it queued
// for the next flush attempt.
// -----------------------------------------------------

bool submitReading(const Reading &r)
{
    String payload = canonicalPayload(r);
    String signature = hmacHex(payload, DEVICE_SECRET);

    String body = "{";
    body += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
    body += "\"seq\":" + String(r.seq) + ",";
    body += "\"timestamp\":" + String(r.timestamp) + ",";
    body += "\"kwh_cumulative\":" + String(r.kwhCumulative, 6) + ",";
    body += "\"kwh_interval\":" + String(r.kwhInterval, 6) + ",";
    body += "\"signature\":\"" + signature + "\"";
    body += "}";

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    if (!http.begin(INGEST_URL))
    {
        Serial.println("HTTP: begin() failed (bad URL?)");
        return false;
    }

    http.addHeader("Content-Type", "application/json");
    int status = http.POST(body);
    http.end();

    if (status == 200 || status == 409)
    {
        // 200: accepted. 409: server already has this (device_id, seq) —
        // safe no-op per the idempotency contract, treat as delivered.
        Serial.print("Ingest: reading seq=");
        Serial.print(r.seq);
        Serial.print(" -> HTTP ");
        Serial.println(status);
        return true;
    }

    Serial.print("Ingest: reading seq=");
    Serial.print(r.seq);
    Serial.print(" failed, HTTP ");
    Serial.println(status);
    return false;
}

// -----------------------------------------------------
// Drain as much of the ring buffer as possible without
// blocking the caller for longer than a few HTTP round
// trips. Called opportunistically from loop(), never from
// inside the Modbus polling section.
// -----------------------------------------------------

void flushPending()
{
    if (ringCount == 0)
        return;

    ensureWifiConnected();
    if (WiFi.status() != WL_CONNECTED)
        return;

    syncTime(); // no-op once already synced; retries here if boot-time sync failed

    Reading r;
    while (ringPeek(r))
    {
        if (!submitReading(r))
            break; // stop draining on first failure, retry next cycle
        ringPop();
    }
}

// -----------------------------------------------------
// SETUP
// -----------------------------------------------------

void setup()
{
    // USB serial monitor
    Serial.begin(115200);

    loadSeq();

    // RS485 direction pin
    pinMode(RS485_DE_RE, OUTPUT);

    // Start in receive mode
    digitalWrite(RS485_DE_RE, LOW);

    // ESP32 UART2
    //
    // 9600 baud
    // 8 data bits
    // No parity
    // 1 stop bit
    // RX = GPIO16
    // TX = GPIO17
    //
    Serial2.begin(
        METER_BAUD,
        SERIAL_8N1,
        RS485_RX,
        RS485_TX
    );

    // Modbus slave ID
    meter.begin(METER_ID, Serial2);

    // RS485 direction callbacks
    meter.preTransmission(preTransmission);
    meter.postTransmission(postTransmission);

    ensureWifiConnected();
    syncTime();

    Serial.println();
    Serial.println("======================================");
    Serial.println(" SELEC EM2M ENERGY MONITOR");
    Serial.println(" ESP32 + RS485 + MODBUS RTU -> INGEST API");
    Serial.println("======================================");
    Serial.print(" device_id: ");
    Serial.println(DEVICE_ID);
    Serial.print(" next_seq : ");
    Serial.println(nextSeq);
    Serial.println();

    delay(1000);
}

// -----------------------------------------------------
// LOOP
// -----------------------------------------------------

void loop()
{
    float voltage = 0.0;
    float current = 0.0;
    float powerKW = 0.0;
    float energy = 0.0;

    // -------------------------------------------------
    // Read Voltage
    // Register: 0x0014
    // -------------------------------------------------

    bool voltageOK =
        readFloatRegister(0x0014, voltage);

    delay(100);

    // -------------------------------------------------
    // Read Current
    // Register: 0x0030
    // -------------------------------------------------

    bool currentOK =
        readFloatRegister(0x0030, current);

    delay(100);

    // -------------------------------------------------
    // Read Power
    // Register: 0x0038
    //
    // Meter value observed in kW
    // -------------------------------------------------

    bool powerOK =
        readFloatRegister(0x0038, powerKW);

    delay(100);

    // -------------------------------------------------
    // Read Energy (cumulative)
    // Register: 0x0020
    //
    // Meter value observed in kWh
    // -------------------------------------------------

    static bool haveLastCumulative = false;
    static float lastCumulative = 0.0;

    bool energyOK =
        readFloatRegister(0x0020, energy);

    delay(100);

    // -------------------------------------------------
    // DISPLAY
    // -------------------------------------------------

    Serial.println();
    Serial.println("----------- METER DATA -----------");

    if (voltageOK)
    {
        Serial.print("Voltage       : ");
        Serial.print(voltage, 2);
        Serial.println(" V");
    }
    else
    {
        printReadError("Voltage");
    }

    if (currentOK)
    {
        Serial.print("Current       : ");
        Serial.print(current, 5);
        Serial.println(" A");
    }
    else
    {
        printReadError("Current");
    }

    if (powerOK)
    {
        float powerW = powerKW * 1000.0;

        Serial.print("Power         : ");
        Serial.print(powerW, 2);
        Serial.println(" W");
    }
    else
    {
        printReadError("Power");
    }

    if (energyOK)
    {
        Serial.print("Energy        : ");
        Serial.print(energy, 6);
        Serial.println(" kWh");
    }
    else
    {
        printReadError("Energy");
    }

    Serial.println("----------------------------------");

    // -------------------------------------------------
    // QUEUE READING FOR INGESTION
    //
    // Only queue when the cumulative register read cleanly —
    // a bad read must never be interpreted as a zero-delta or
    // a meter reset. The very first successful read after boot
    // just establishes the baseline; it has no prior value to
    // diff against, so it is not queued.
    // -------------------------------------------------

    if (energyOK)
    {
        if (!haveLastCumulative)
        {
            lastCumulative = energy;
            haveLastCumulative = true;
        }
        else
        {
            float interval = energy - lastCumulative;
            lastCumulative = energy;

            // Negative delta here means a meter reset or read glitch.
            // Do not fabricate a reading from it — let the backend's
            // monotonicity check handle it once seq/timestamp catch up,
            // or drop it locally rather than submit garbage.
            if (interval < 0)
            {
                Serial.println("WARN: negative interval delta (meter reset?), skipping");
            }
            else
            {
                Reading r;
                r.seq = nextSeq++;
                r.timestamp = (uint32_t)time(nullptr); // best-effort; seq is authoritative
                r.kwhCumulative = energy;
                r.kwhInterval = interval;

                saveSeq();
                ringPush(r);
            }
        }
    }

    // Attempt to drain any queued readings (this run's and any
    // buffered from prior offline periods). Bounded by HTTP_TIMEOUT_MS
    // per attempt so it can't stall the next Modbus poll indefinitely.
    flushPending();

    // Wait before next complete measurement cycle
    delay(REPORT_INTERVAL_MS);
}
