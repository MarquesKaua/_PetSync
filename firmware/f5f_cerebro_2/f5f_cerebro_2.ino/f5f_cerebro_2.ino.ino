#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "segredos.h"

const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// ===== CALIBRACAO (montagem provisoria) =====
const float DIST_VAZIO_CM = 14.5;
const float DIST_CHEIO_CM = 11.4;
const float TOLERANCIA_CM = 2.0;
// ============================================

// Deixe true so uma vez, para apagar a config da flash e testar o "primeiro uso"
const bool LIMPAR_CONFIG_NA_PARTIDA = false;

const unsigned long INTERVALO_ENVIO_MS = 5000;
const int JANELA = 5;
const int FALHAS_PARA_INVALIDAR = 3;

float historico[JANELA];
int quantos = 0;
int proximo = 0;
int falhasSeguidas = 0;

WiFiClientSecure rede;
PubSubClient mqtt(rede);
Preferences prefs;

// ---------- configuracao ----------
struct Config {
  int versao = 0;
  int porcao_g = 0;
  int limite_diario_g = 0;
  int n_horarios = 0;
  char horarios[6][6];  // "HH:MM" + terminador
  int agua_min = 0;
  int agua_alvo = 0;
};
Config cfg;

bool horarioOk(const char *h) {
  if (!h || strlen(h) != 5 || h[2] != ':') return false;
  if (!isdigit(h[0]) || !isdigit(h[1]) || !isdigit(h[3]) || !isdigit(h[4])) return false;
  int hh = (h[0] - '0') * 10 + (h[1] - '0');
  int mm = (h[3] - '0') * 10 + (h[4] - '0');
  return hh <= 23 && mm <= 59;
}

bool configValida(const Config &c) {
  return c.versao > 0 && c.porcao_g > 0 && c.limite_diario_g >= c.porcao_g &&
         c.n_horarios >= 1 && c.n_horarios <= 6 &&
         c.agua_min >= 0 && c.agua_min < c.agua_alvo && c.agua_alvo <= 100;
}

void imprimirConfig(const Config &c) {
  Serial.printf("   versao=%d porcao=%d g limite_diario=%d g\n", c.versao, c.porcao_g, c.limite_diario_g);
  Serial.print("   horarios:");
  for (int i = 0; i < c.n_horarios; i++) Serial.printf(" %s", c.horarios[i]);
  Serial.printf("\n   agua: minimo=%d%% alvo=%d%%\n", c.agua_min, c.agua_alvo);
}

void salvarConfig() {
  String lista = "";
  for (int i = 0; i < cfg.n_horarios; i++) {
    if (i) lista += ",";
    lista += cfg.horarios[i];
  }
  prefs.begin("petsync", false);
  prefs.putInt("porcao", cfg.porcao_g);
  prefs.putInt("limite", cfg.limite_diario_g);
  prefs.putInt("agua_min", cfg.agua_min);
  prefs.putInt("agua_alvo", cfg.agua_alvo);
  prefs.putString("horarios", lista);
  prefs.putInt("versao", cfg.versao);  // por ultimo, de proposito
  prefs.end();
}

void carregarConfig() {
  prefs.begin("petsync", false);
  if (LIMPAR_CONFIG_NA_PARTIDA) {
    prefs.clear();
    Serial.println("Config apagada da flash (LIMPAR_CONFIG_NA_PARTIDA).");
  }
  Config c;
  c.versao = prefs.getInt("versao", 0);
  c.porcao_g = prefs.getInt("porcao", 0);
  c.limite_diario_g = prefs.getInt("limite", 0);
  c.agua_min = prefs.getInt("agua_min", 0);
  c.agua_alvo = prefs.getInt("agua_alvo", 0);
  String lista = prefs.getString("horarios", "");
  prefs.end();

  int ini = 0;
  while (ini < (int)lista.length() && c.n_horarios < 6) {
    int fim = lista.indexOf(',', ini);
    if (fim < 0) fim = lista.length();
    String h = lista.substring(ini, fim);
    if (!horarioOk(h.c_str())) { c.n_horarios = 0; break; }
    strcpy(c.horarios[c.n_horarios++], h.c_str());
    ini = fim + 1;
  }

  if (configValida(c)) {
    cfg = c;
    Serial.println("Config carregada da flash:");
    imprimirConfig(cfg);
  } else {
    Serial.println("Nenhuma config valida na flash (aguardando o Node).");
  }
}

void tratarConfig(JsonDocument &doc) {
  Config c;
  c.versao = doc["versao"] | 0;
  c.porcao_g = doc["porcao_g"] | 0;
  c.limite_diario_g = doc["limite_diario_g"] | 0;
  c.agua_min = doc["agua"]["nivel_minimo_pct"] | -1;
  c.agua_alvo = doc["agua"]["nivel_alvo_pct"] | -1;
  for (JsonVariant h : doc["horarios"].as<JsonArray>()) {
    const char *s = h.as<const char *>();
    if (c.n_horarios >= 6 || !horarioOk(s)) { c.n_horarios = 0; break; }
    strcpy(c.horarios[c.n_horarios++], s);
  }

  if (!configValida(c)) {
    Serial.println("   config INVALIDA: ignorada");
    return;
  }
  if (c.versao <= cfg.versao) {
    Serial.printf("   versao %d nao e mais nova que a atual (%d): ignorada, sem gravar\n", c.versao, cfg.versao);
    return;
  }
  cfg = c;
  salvarConfig();
  Serial.println("   config nova aplicada e salva na flash:");
  imprimirConfig(cfg);
}

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
      quantos = 0;
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

// ---------- ouvir o que o Node manda ----------
bool horaValida() {
  return time(nullptr) > 1700000000;
}

void aoReceber(char *topico, byte *payload, unsigned int tam) {
  Serial.printf("\n<< %s (%u bytes)\n", topico, tam);

  JsonDocument doc;
  DeserializationError erro = deserializeJson(doc, payload, tam);
  if (erro) {
    Serial.printf("   JSON invalido: %s\n", erro.c_str());
    return;
  }

  String t = topico;
  if (t == "petsync/config") {
    tratarConfig(doc);
  } else if (t == "petsync/racao/liberar") {
    const char *id = doc["cmd_id"] | "?";
    long ts = doc["ts"] | 0L;
    long idade = horaValida() ? (long)time(nullptr) - ts : -1;
    Serial.printf("   PEDIDO cmd_id=%s meta=%d g origem=%s\n", id,
                  (int)(doc["quantidade_g"] | 0), (const char *)(doc["origem"] | "?"));
    if (idade >= 0) Serial.printf("   idade do pedido: %ld s\n", idade);
    Serial.println("   (ainda nao executo nada: so estou ouvindo)");
  }
}

// ---------- rede ----------
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
      mqtt.subscribe("petsync/config", 1);
      mqtt.subscribe("petsync/racao/liberar", 1);
      Serial.println("Ouvindo: petsync/config e petsync/racao/liberar");
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

  carregarConfig();  // antes do Wi-Fi: funciona mesmo sem internet

  conectarWifi();
  sincronizarHora();
  rede.setCACert(EMQX_CA);
  mqtt.setServer(MQTT_HOST, MQTT_PORTA);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(aoReceber);
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
             "{\"nivel_pct\":%d,\"distancia_cm\":%.1f,\"valido\":true,\"ts\":%ld}", pct, d, ts);
  } else {
    snprintf(msg, sizeof(msg),
             "{\"nivel_pct\":null,\"distancia_cm\":%.1f,\"valido\":false,\"ts\":%ld}",
             d < 0 ? -1.0 : d, ts);
  }

  bool enviado = mqtt.publish("petsync/agua/nivel", msg);
  Serial.printf("agua: %s (%s)\n", msg, enviado ? "ok" : "falhou");
}