#include <WiFi.h>
#include "segredos.h"

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("Conectando em %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 20000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConectado! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nNao conectou (rede 2,4 GHz? senha certa?)");
  }
}

void loop() {}