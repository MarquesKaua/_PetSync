#include <WiFi.h>
#include <time.h>
#include "segredos.h"

bool horaValida() {
  return time(nullptr) > 1700000000;  // depois de 2023 = sincronizada
}

void setup() {
  Serial.begin(115200);
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);
  Serial.print("Conectando no Wi-Fi");
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 20000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nSem Wi-Fi.");
    return;
  }
  Serial.println("\nWi-Fi ok.");

  // Fuso de Brasilia (UTC-3, sem horario de verao)
  configTzTime("<-03>3", "pool.ntp.org", "time.google.com");

  Serial.print("Pedindo a hora");
  inicio = millis();
  while (!horaValida() && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (horaValida()) {
    Serial.println("\nHora sincronizada.");
  } else {
    Serial.println("\nSem hora valida (internet funcionando?).");
  }
}

void loop() {
  if (horaValida()) {
    struct tm t;
    getLocalTime(&t);
    char texto[32];
    strftime(texto, sizeof(texto), "%d/%m/%Y %H:%M:%S", &t);
    Serial.printf("Agora: %s  | ts: %ld\n", texto, (long)time(nullptr));
  } else {
    Serial.println("Sem hora valida");
  }
  delay(2000);
}