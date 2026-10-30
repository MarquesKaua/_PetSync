require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");

const { MQTT_HOST, MQTT_PORT, ESP32_USER, ESP32_PASS, MQTT_CA } = process.env;
const [, , cmdId, status, flag] = process.argv;

if (!cmdId || !status) {
  console.error("Uso: node simulador-confirmacao.js ID STATUS [--duas-vezes]");
  console.error("STATUS: executado | duplicado | expirado | rejeitado | falhou");
  process.exit(1);
}

const opcoes = {
  host: MQTT_HOST,
  port: Number(MQTT_PORT || 8883),
  protocol: "mqtts",
  username: ESP32_USER,
  password: ESP32_PASS,
  clientId: "petsync-simulador-" + Math.random().toString(16).slice(2, 8),
};
if (MQTT_CA) opcoes.ca = fs.readFileSync(MQTT_CA);

const origem = cmdId.startsWith("ag-") ? "agendado" : "manual";
const ts = Math.floor(Date.now() / 1000);

let msg = { cmd_id: cmdId, origem, meta_g: 150, status, motivo: null, ts };
if (status === "executado") {
  msg = { ...msg, peso_antes_g: 12.0, peso_depois_g: 150.5 };
} else if (status === "falhou") {
  msg = { ...msg, peso_antes_g: 12.0, peso_depois_g: 12.0, motivo: "Ração travou no dispensador" };
} else if (status === "rejeitado") {
  msg = { ...msg, peso_antes_g: null, peso_depois_g: null, motivo: "Pote já estava cheio" };
} else {
  msg = { ...msg, peso_antes_g: null, peso_depois_g: null };
}

const client = mqtt.connect(opcoes);
client.on("connect", () => {
  const vezes = flag === "--duas-vezes" ? 2 : 1;
  for (let i = 0; i < vezes; i++) {
    client.publish("petsync/racao/confirmacao", JSON.stringify(msg), { qos: 1 });
  }
  console.log(`Confirmação "${status}" enviada ${vezes}x para ${cmdId}.`);
  setTimeout(() => client.end(), 1500);
});
client.on("error", (e) => console.error("Erro:", e.message));