#include <HX711.h>

const int DT_PIN  = 16;
const int SCK_PIN = 4;

HX711 balanca;

void setup() {
  Serial.begin(115200);
  delay(500);
  balanca.begin(DT_PIN, SCK_PIN);
  Serial.println("Balanca: lendo valor cru. Aperte de leve a ponta livre da celula.");
}

void loop() {
  if (!balanca.wait_ready_timeout(1000)) {
    Serial.println("HX711 nao responde (confira VCC, GND, DT e SCK)");
    return;
  }
  long cru = balanca.read_average(5);
  Serial.printf("cru = %ld\n", cru);
  delay(300);
}