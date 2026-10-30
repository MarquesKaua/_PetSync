#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include "segredos.h"

WiFiClientSecure rede;
PubSubClient mqtt(rede);

bool horaValida() {
  return time(nullptr) > 1700000000;
}

void conectarWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);
  Serial.print("Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" ok");
}

void sincronizarHora() {
  configTzTime("<-03>3", "pool.ntp.org", "time.google.com");
  Serial.print("Hora");
  while (!horaValida()) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" ok");
}

void conectarMqtt() {
  while (!mqtt.connected()) {
    String id = "petsync-esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    Serial.print("MQTT...");
    if (mqtt.connect(id.c_str(), MQTT_USER, MQTT_SENHA)) {
      Serial.println(" conectado");
    } else {
      Serial.printf(" falhou (estado %d). Tentando de novo em 5 s\n", mqtt.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  conectarWifi();
  sincronizarHora();          // o TLS precisa da data certa
  rede.setCACert(EMQX_CA);
  mqtt.setServer(MQTT_HOST, MQTT_PORTA);
}

void loop() {
  if (!mqtt.connected()) conectarMqtt();
  mqtt.loop();

  static unsigned long ultimo = 0;
  if (millis() - ultimo >= 5000) {
    ultimo = millis();
    char msg[128];
    snprintf(msg, sizeof(msg),
             "{\"nivel_pct\":72,\"distancia_cm\":4.3,\"valido\":true,\"ts\":%ld}",
             (long)time(nullptr));
    bool ok = mqtt.publish("petsync/agua/nivel", msg);
    Serial.printf("publicado: %s (%s)\n", msg, ok ? "ok" : "falhou");
  }
}