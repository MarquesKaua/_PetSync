const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// ===== CALIBRACAO =====
const float DIST_VAZIO_CM = 14.5;  // sensor ate o fundo da tigela seca (0%)
const float DIST_CHEIO_CM = 11.4;  // sensor ate a agua no nivel maximo (100%)
const float TOLERANCIA_CM = 2.0;
// ======================

const int JANELA = 5;              // quantas medianas guardar
float historico[JANELA];
int quantos = 0;
int proximo = 0;

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

void ordenar(float *v, int k) {
  for (int i = 0; i < k - 1; i++)
    for (int j = i + 1; j < k; j++)
      if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }
}

float lerMediana(int n = 9) {
  float v[15];
  int k = 0;
  for (int i = 0; i < n && i < 15; i++) {
    float d = lerUmaVez();
    if (d >= 2 && d <= 400) v[k++] = d;
    delay(60);
  }
  if (k < n / 2 + 1) return -1;
  ordenar(v, k);
  return v[k / 2];
}

// Guarda a leitura e devolve a mediana das ultimas. -1 se faltar dado confiavel.
float filtrar(float nova) {
  if (nova > 0) {
    historico[proximo] = nova;
    proximo = (proximo + 1) % JANELA;
    if (quantos < JANELA) quantos++;
  }
  if (quantos < 3) return -1;

  float copia[JANELA];
  for (int i = 0; i < quantos; i++) copia[i] = historico[i];
  ordenar(copia, quantos);
  return copia[quantos / 2];
}

bool distanciaParaPct(float d, int &pct) {
  if (d < 0) return false;
  if (d < DIST_CHEIO_CM - TOLERANCIA_CM) return false;
  if (d > DIST_VAZIO_CM + TOLERANCIA_CM) return false;

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
  float bruta = lerMediana();
  float d = filtrar(bruta);
  int pct = 0;
  bool ok = distanciaParaPct(d, pct);

  Serial.printf("bruta=%.1f  filtrada=%.1f  ", bruta, d);
  if (ok) {
    Serial.printf("-> {\"nivel_pct\":%d,\"distancia_cm\":%.1f,\"valido\":true}\n", pct, d);
  } else {
    Serial.println("-> {\"nivel_pct\":null,\"valido\":false}");
  }
  delay(300);
}