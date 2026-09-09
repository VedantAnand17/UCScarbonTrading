#include <Arduino.h>
#include <ModbusMaster.h>

#define MAX485_DE_RE 4

ModbusMaster node;

// RS485 direction control
void preTransmission() {
  digitalWrite(MAX485_DE_RE, HIGH);
}

void postTransmission() {
  digitalWrite(MAX485_DE_RE, LOW);
}

// Convert Modbus registers → float (your meter uses swapped word order)
float toFloat(uint16_t high, uint16_t low) {
  uint32_t combined = ((uint32_t)low << 16) | high;
  float value;
  memcpy(&value, &combined, sizeof(value));
  return value;
}

// 🔥 Robust register read with retries
float readReg(uint16_t reg) {
  for (int i = 0; i < 3; i++) {
    uint8_t result = node.readInputRegisters(reg, 2);

    if (result == node.ku8MBSuccess) {
      uint16_t h = node.getResponseBuffer(0);
      uint16_t l = node.getResponseBuffer(1);
      return toFloat(h, l);
    }

    delay(50);  // retry delay
  }

  return -1;  // failed after retries
}

void setup() {
  Serial.begin(115200);

  pinMode(MAX485_DE_RE, OUTPUT);
  digitalWrite(MAX485_DE_RE, LOW);

  Serial2.begin(9600, SERIAL_8N1, 16, 17);

  node.begin(1, Serial2);
  node.preTransmission(preTransmission);
  node.postTransmission(postTransmission);

  Serial.println("=== FINAL ENERGY METER SYSTEM ===");
}

void loop() {

  // 🔹 Read registers (with spacing)
  float voltage = readReg(0x0014);
  delay(50);

  float powerKW = readReg(0x0038);
  delay(50);

  float energy  = readReg(0x0020);
  delay(50);

  float current_raw = readReg(0x0030);
  delay(50);

  // 🔹 If any read fails, skip cycle
  if (voltage < 0 || powerKW < 0 || energy < 0 || current_raw < 0) {
    Serial.println("⚠️ Read error from meter");
    delay(1000);
    return;
  }

  // 🔹 Apply scaling
  float current = current_raw * 4.5;   // calibrated scaling
  float powerW = powerKW * 1000.0;

  // 🔹 Output
  Serial.println("\n------ ENERGY METER DATA ------");

  Serial.print("Voltage (V): ");
  Serial.println(voltage, 2);

  Serial.print("Current (A): ");
  Serial.println(current, 3);

  Serial.print("Power (W): ");
  Serial.println(powerW, 2);

  Serial.print("Energy (kWh): ");
  Serial.println(energy, 6);

  Serial.println("--------------------------------");

  delay(2000);
}