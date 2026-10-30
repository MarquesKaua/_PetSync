const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

float lerDistanciaCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duracao = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duracao == 0) return -1;

  return duracao * 0.0343 / 2.0;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  float d = lerDistanciaCm();
  if (d < 0) {
    Serial.println("Sem leitura (verifique a ligacao)");
  } else {
    Serial.printf("Distancia: %.1f cm\n", d);
  }
  delay(500);
}