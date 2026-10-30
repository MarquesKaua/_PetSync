const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// ===== CALIBRACAO =====
// Troque estes numeros quando a montagem mudar.
const float DIST_VAZIO_CM = 14.5;  // sensor ate o fundo da tigela seca (0%)
const float DIST_CHEIO_CM = 11.8;  // sensor ate a agua no nivel maximo (100%)
const float TOLERANCIA_CM = 2.0;   // margem antes de considerar leitura absurda
// ======================

float lerUmaVez() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duracao = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duracao == 0) return -1;
  return duracao * 0.0343 / 2.0;
}

float lerMediana(int n = 7) {
  float v[15];
  int k = 0;
  for (int i = 0; i < n && i < 15; i++) {
    float d = lerUmaVez();
    if (d >= 2 && d <= 400) v[k++] = d;
    delay(60);
  }
  if (k < n / 2 + 1) return -1;

  for (int i = 0; i < k - 1; i++)
    for (int j = i + 1; j < k; j++)
      if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }

  return v[k / 2];
}

// Converte distancia em porcentagem. Retorna false se a leitura for absurda.
bool distanciaParaPct(float d, int &pct) {
  if (d < 0) return false;
  if (d < DIST_CHEIO_CM - TOLERANCIA_CM) return false;   // perto demais
  if (d > DIST_VAZIO_CM + TOLERANCIA_CM) return false;   // longe demais

  float p = (DIST_VAZIO_CM - d) / (DIST_VAZIO_CM - DIST_CHEIO_CM) * 100.0;
  if (p < 0) p = 0;
  if (p > 100) p = 100;
  pct = (int)(p + 0.5);
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  float d = lerMediana();
  int pct = 0;
  bool ok = distanciaParaPct(d, pct);

  if (ok) {
    Serial.printf("{\"nivel_pct\":%d,\"distancia_cm\":%.1f,\"valido\":true}\n", pct, d);
  } else {
    Serial.printf("{\"nivel_pct\":null,\"distancia_cm\":%.1f,\"valido\":false}\n", d);
  }
  delay(1000);
}