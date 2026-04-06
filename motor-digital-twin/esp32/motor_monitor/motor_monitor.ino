#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- Network & Supabase Settings ---
const char* ssid = "Padma";
const char* password = "dumbu5827";
const char* supabase_url = "https://mfrbnxzhmsgskyvxqcxw.supabase.co/rest/v1/telemetry";
const char* supabase_key = "sb_publishable_p5yFqBJCGW6bhv31q4rovQ_IUfRbszr";

// --- Pin Definitions ---
const int TEMP_PIN = 34;
const int CURRENT_PIN = 35;
const int VIB_PIN = 32;
const int VOLTAGE_PIN = 33;
const int RPM_PIN = 18;

// --- Variables ---
volatile int pulse_count = 0;
unsigned long last_rpm_time = 0;

float rpm = 0;
float temperature = 0;
float current = 0;
float vibration = 0;
float voltage = 0;
float power = 0;

const float EMA_ALPHA = 0.1;

// ✅ Interrupt function (fixed)
void countPulse() {
  pulse_count++;
}

// --- WiFi ---
void setup_wifi() {
  Serial.print("Connecting to WiFi...");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
}

// --- MQTT ---
// (MQTT Reconnect removed as we use HTTPS now)

void setup() {
  Serial.begin(115200);

  pinMode(RPM_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(RPM_PIN), countPulse, FALLING);

  setup_wifi();

  last_rpm_time = millis();
}

void loop() {
  // (MQTT loop removed)

  static unsigned long last_send = 0;

  if (millis() - last_send > 1000) {
    last_send = millis();

    // --- RPM Calculation ---
    unsigned long now = millis();
    unsigned long delta = now - last_rpm_time;

    if (delta > 0) {
      rpm = (pulse_count * 60000.0) / delta;
    }

    pulse_count = 0;
    last_rpm_time = now;

    // --- Sensor Reads ---
    float raw_temp = analogRead(TEMP_PIN) * (3.3 / 4095.0) * 100.0;
    float raw_curr = (analogRead(CURRENT_PIN) * (3.3 / 4095.0)) / 0.066;
    float raw_vib = analogRead(VIB_PIN) / 4095.0;
    
    // Assume a 5:1 voltage divider (max 16.5V for 3.3V analog input)
    float raw_volt = analogRead(VOLTAGE_PIN) * (3.3 / 4095.0) * 5.0;

    // --- Filtering ---
    temperature = (EMA_ALPHA * raw_temp) + ((1 - EMA_ALPHA) * temperature);
    current = (EMA_ALPHA * raw_curr) + ((1 - EMA_ALPHA) * current);
    vibration = (EMA_ALPHA * raw_vib) + ((1 - EMA_ALPHA) * vibration);
    voltage = (EMA_ALPHA * raw_volt) + ((1 - EMA_ALPHA) * voltage);
    
    // Calculate power (W = V * A)
    power = voltage * current;

    // --- JSON ---
    StaticJsonDocument<200> doc;
    doc["temperature"] = temperature;
    doc["current"] = current;
    doc["vibration"] = vibration;
    doc["voltage"] = voltage;
    doc["power"] = power;
    doc["rpm"] = (int)rpm;

    char buffer[256];
    serializeJson(doc, buffer);

    // --- Send to Supabase ---
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(supabase_url);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("apikey", supabase_key);
      http.addHeader("Authorization", "Bearer " + String(supabase_key));

      int httpResponseCode = http.POST(buffer);

      if (httpResponseCode > 0) {
        Serial.print("Supabase Response: ");
        Serial.println(httpResponseCode);
      } else {
        Serial.print("Error sending POST: ");
        Serial.println(httpResponseCode);
      }
      http.end();
    }
  }
}
