#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"
#include <time.h>
#include "segredos.h"

const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// ===== CALIBRACAO (montagem provisoria) =====
const float DIST_VAZIO_CM = 14.5;
const float DIST_CHEIO_CM = 11.4;
const float TOLERANCIA_CM = 2.0;

// ===== SO PARA TESTES: deixe true uma vez, grave, e volte para false =====
const bool LIMPAR_CONFIG_NA_PARTIDA = false;
const bool LIMPAR_FEITOS_NA_PARTIDA = false;  // apaga IDs e gramas do dia

// ===== ALIMENTACAO (dispensador SIMULADO) =====
const int JANELA_ATRASO_MIN = 15;
const float PESO_ANTES_SIMULADO = 12.0;

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


Config cfg;

bool horaValida() {
  return time(nullptr) > 1700000000;
}


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
    Serial.println("Flash apagada (LIMPAR_CONFIG_NA_PARTIDA).");
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
    Serial.printf("   versao %d nao e mais nova que a atual (%d): ignorada\n", c.versao, cfg.versao);
    return;
  }
  cfg = c;
  salvarConfig();
  Serial.println("   config nova aplicada e salva na flash:");
  imprimirConfig(cfg);
}

// ---------- historico de alimentacoes (flash) ----------
char feitos[8][24];
int idxFeito = 0;
int diaSalvo = 0;
int gramasDia = 0;

void carregarFeitos() {
  prefs.begin("petsync", false);
  if (LIMPAR_FEITOS_NA_PARTIDA) {
    for (int i = 0; i < 8; i++) {
      char k[6];
      snprintf(k, sizeof(k), "id%d", i);
      prefs.remove(k);
    }
    prefs.remove("idx");
    prefs.remove("dia");
    prefs.remove("gdia");
    Serial.println("IDs e gramas do dia apagados (LIMPAR_FEITOS_NA_PARTIDA).");
  }
  for (int i = 0; i < 8; i++) {
    char k[6];
    snprintf(k, sizeof(k), "id%d", i);
    String s = prefs.getString(k, "");
    strncpy(feitos[i], s.c_str(), 23);
    feitos[i][23] = 0;
  }
  idxFeito = prefs.getInt("idx", 0) % 8;
  diaSalvo = prefs.getInt("dia", 0);
  gramasDia = prefs.getInt("gdia", 0);
  prefs.end();
  Serial.printf("Historico: %d g liberados no dia %d\n", gramasDia, diaSalvo);
}

bool jaFeito(const char *id) {
  for (int i = 0; i < 8; i++)
    if (strcmp(feitos[i], id) == 0) return true;
  return false;
}

void marcarFeito(const char *id) {
  strncpy(feitos[idxFeito], id, 23);
  feitos[idxFeito][23] = 0;
  prefs.begin("petsync", false);
  char k[6];
  snprintf(k, sizeof(k), "id%d", idxFeito);
  prefs.putString(k, id);
  idxFeito = (idxFeito + 1) % 8;
  prefs.putInt("idx", idxFeito);
  prefs.end();
}

int gramasHoje(int hoje) {
  if (diaSalvo != hoje) {
    diaSalvo = hoje;
    gramasDia = 0;
    prefs.begin("petsync", false);
    prefs.putInt("dia", hoje);
    prefs.putInt("gdia", 0);
    prefs.end();
  }
  return gramasDia;
}

void somarGramas(int hoje, int g) {
  gramasHoje(hoje);
  gramasDia += g;
  prefs.begin("petsync", false);
  prefs.putInt("gdia", gramasDia);
  prefs.end();
}

// ---------- confirmacoes (fila na RAM) ----------
const int FILA_MAX = 4;
char fila[FILA_MAX][300];
int nFila = 0;

void enfileirar(const char *msg) {
  if (nFila == FILA_MAX) {
    for (int i = 1; i < FILA_MAX; i++) strcpy(fila[i - 1], fila[i]);
    nFila--;
  }
  strncpy(fila[nFila], msg, 299);
  fila[nFila][299] = 0;
  nFila++;
}

void descarregarFila() {
  while (nFila > 0 && mqtt.connected()) {
    if (!mqtt.publish("petsync/racao/confirmacao", fila[0])) break;
    Serial.println("   confirmacao enviada ao Node.");
    for (int i = 1; i < nFila; i++) strcpy(fila[i - 1], fila[i]);
    nFila--;
  }
}

void confirmar(const char *id, int meta, const char *status, float antes, float depois, const char *motivo) {
  JsonDocument d;
  d["cmd_id"] = id;
  d["origem"] = "agendado";
  d["meta_g"] = meta;
  d["status"] = status;
  if (antes >= 0) d["peso_antes_g"] = antes; else d["peso_antes_g"] = nullptr;
  if (depois >= 0) d["peso_depois_g"] = depois; else d["peso_depois_g"] = nullptr;
  if (motivo) d["motivo"] = motivo; else d["motivo"] = nullptr;
  d["ts"] = (long)time(nullptr);

  char buf[300];
  serializeJson(d, buf, sizeof(buf));
  Serial.printf("   confirmacao: %s\n", buf);
  enfileirar(buf);
  if (!mqtt.connected()) Serial.println("   sem conexao com o broker: confirmacao guardada na fila");
  descarregarFila();
}

// ---------- alimentacao agendada ----------
int hojeNumero(const struct tm &t) {
  return (t.tm_year + 1900) * 10000 + (t.tm_mon + 1) * 100 + t.tm_mday;
}

void executarAgendada(const char *id, int hoje) {
  int meta = cfg.porcao_g;
  Serial.printf("\n>> HORARIO %s (meta %d g)\n", id, meta);
  marcarFeito(id);  // antes de agir: se faltar luz no meio, prefere pular a repetir

  float antes = PESO_ANTES_SIMULADO;
  float necessario = meta - antes;
  if (necessario < 0) necessario = 0;

  if (antes >= meta) {
    Serial.println("   REJEITADO: pote ja estava cheio");
    confirmar(id, meta, "rejeitado", antes, -1, "Pote ja estava cheio");
    return;
  }
  if (gramasHoje(hoje) + necessario > cfg.limite_diario_g) {
    Serial.printf("   REJEITADO: limite diario (%d g ja liberados + %.0f g > %d g)\n",
                  gramasDia, necessario, cfg.limite_diario_g);
    confirmar(id, meta, "rejeitado", antes, -1, "Limite diario atingido");
    return;
  }

  Serial.println("   [DISPENSADOR] abrindo (simulado)...");
  delay(1500);
  Serial.println("   [DISPENSADOR] fechando (simulado)");
  float depois = meta + 0.5;
  somarGramas(hoje, (int)(depois - antes + 0.5));
  Serial.printf("   EXECUTADO: %.1f -> %.1f g | %d g liberados hoje\n", antes, depois, gramasDia);
  confirmar(id, meta, "executado", antes, depois, nullptr);
}

void verificarHorarios() {
  static unsigned long ultimoCheck = 0;
  static unsigned long ultimoAviso = 0;
  static char ultimoIgnorado[24] = "";

  if (millis() - ultimoCheck < 1000) return;
  ultimoCheck = millis();

  if (cfg.versao == 0) return;

  if (!horaValida()) {
    if (millis() - ultimoAviso > 30000) {
      ultimoAviso = millis();
      Serial.println("Sem hora valida: horarios suspensos (nao alimenta).");
    }
    return;
  }

  struct tm t;
  if (!getLocalTime(&t, 0)) return;
  int minutosAgora = t.tm_hour * 60 + t.tm_min;
  int hoje = hojeNumero(t);

  for (int i = 0; i < cfg.n_horarios; i++) {
    const char *h = cfg.horarios[i];
    int hh = (h[0] - '0') * 10 + (h[1] - '0');
    int mm = (h[3] - '0') * 10 + (h[4] - '0');
    int atraso = minutosAgora - (hh * 60 + mm);
    if (atraso < 0 || atraso > JANELA_ATRASO_MIN) continue;

    char id[24];
    snprintf(id, sizeof(id), "ag-%04d-%02d-%02d-%02d%02d",
             t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, hh, mm);

    if (jaFeito(id)) {
      if (strcmp(ultimoIgnorado, id) != 0) {
        strcpy(ultimoIgnorado, id);
        Serial.printf("Horario %s ja foi tratado hoje: ignorado.\n", id);
      }
      continue;
    }
    executarAgendada(id, hoje);
  }
}

// ---------- sensor de agua ----------
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

void lerEPublicarAgua() {
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

  if (mqtt.connected()) {
    bool enviado = mqtt.publish("petsync/agua/nivel", msg);
    Serial.printf("agua: %s (%s)\n", msg, enviado ? "ok" : "falhou");
  } else {
    Serial.printf("agua: %s (sem conexao)\n", msg);
  }
}

// ---------- ouvir o Node ----------
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
    Serial.printf("   PEDIDO cmd_id=%s meta=%d g (execucao manual: proximo passo)\n",
                  (const char *)(doc["cmd_id"] | "?"), (int)(doc["quantidade_g"] | 0));
  }
}

// ---------- conexoes (sem travar) ----------
void manterConexoes() {
  static unsigned long tentativaWifi = 0;
  static unsigned long tentativaMqtt = 0;
  static bool eraConectado = false;

  bool conectado = (WiFi.status() == WL_CONNECTED);
  if (conectado && !eraConectado) {
    Serial.printf("Wi-Fi conectado. IP: %s\n", WiFi.localIP().toString().c_str());
    configTzTime("<-03>3", "pool.ntp.org", "time.google.com");
  }
  if (!conectado && eraConectado) Serial.println("Wi-Fi caiu.");
  eraConectado = conectado;

  if (!conectado) {
    if (millis() - tentativaWifi > 15000) {
      tentativaWifi = millis();
      Serial.println("Tentando conectar no Wi-Fi...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_SENHA);
    }
    return;
  }

  if (mqtt.connected()) return;
  if (millis() - tentativaMqtt < 5000) return;
  tentativaMqtt = millis();

  if (!horaValida()) {
    Serial.println("Aguardando a hora (o TLS precisa da data certa)...");
    return;
  }

  String id = "petsync-esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("MQTT...");
  if (mqtt.connect(id.c_str(), MQTT_USER, MQTT_SENHA)) {
    Serial.println(" conectado");
    mqtt.subscribe("petsync/config", 1);
    mqtt.subscribe("petsync/racao/liberar", 1);
  } else {
    Serial.printf(" falhou (estado %d)\n", mqtt.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  carregarConfig();   // funciona sem internet
  carregarFeitos();

  rede.setCACert(EMQX_CA);
  mqtt.setServer(MQTT_HOST, MQTT_PORTA);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(aoReceber);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);  // sem esperar
  configTzTime("<-03>3", "pool.ntp.org", "time.google.com");
}

void loop() {
  manterConexoes();
  mqtt.loop();
  descarregarFila();
  verificarHorarios();
  lerEPublicarAgua();
}