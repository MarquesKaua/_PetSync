#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include "segredos.h"

const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// ===== CALIBRACAO (montagem provisoria) =====
const float DIST_VAZIO_CM = 14.5;
const float DIST_CHEIO_CM = 11.4;
const float TOLERANCIA_CM = 2.0;
// ============================================

const unsigned long INTERVALO_ENVIO_MS = 5000;
const int JANELA = 5;
const int FALHAS_PARA_INVALIDAR = 3;

float historico[JANELA];
int quantos = 0;
int proximo = 0;
int falhasSeguidas = 0;

WiFiClientSecure rede;
PubSubClient mqtt(rede);

// ---------- sensor ----------
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

float filtrar(float nova) {
  if (nova > 0) {
    falhasSeguidas = 0;
    historico[proximo] = nova;
    proximo = (proximo + 1) % JANELA;
    if (quantos < JANELA) quantos++;
  } else {
    falhasSeguidas++;
    if (falhasSeguidas >= FALHAS_PARA_INVALIDAR) {
      quantos = 0;      // sensor falhando: esquece o passado
      proximo = 0;
    }
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

// ---------- rede ----------
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
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  conectarWifi();
  sincronizarHora();
  rede.setCACert(EMQX_CA);
  mqtt.setServer(MQTT_HOST, MQTT_PORTA);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) conectarWifi();
  if (!mqtt.connected()) conectarMqtt();
  mqtt.loop();

  static unsigned long ultimo = 0;
  if (millis() - ultimo < INTERVALO_ENVIO_MS) return;
  ultimo = millis();

  float bruta = lerMediana();
  float d = filtrar(bruta);

  // Filtro ainda sem dados suficientes: nao publica
  if (quantos < 3 && falhasSeguidas < FALHAS_PARA_INVALIDAR) {
    Serial.println("aquecendo o filtro...");
    return;
  }

  int pct = 0;
  bool ok = distanciaParaPct(d, pct);
  long ts = (long)time(nullptr);

  char msg[160];
  if (ok) {
    snprintf(msg, sizeof(msg),
             "{\"nivel_pct\":%d,\"distancia_cm\":%.1f,\"valido\":true,\"ts\":%ld}",
             pct, d, ts);
  } else {
    snprintf(msg, sizeof(msg),
             "{\"nivel_pct\":null,\"distancia_cm\":%.1f,\"valido\":false,\"ts\":%ld}",
             d < 0 ? -1.0 : d, ts);
  }

  bool enviado = mqtt.publish("petsync/agua/nivel", msg);
  Serial.printf("bruta=%.1f filtrada=%.1f -> %s (%s)\n", bruta, d, msg, enviado ? "ok" : "falhou");
}