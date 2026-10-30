require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");

const { MQTT_HOST, MQTT_PORT, ESP32_USER, ESP32_PASS, MQTT_CA } = process.env;
const mudo = process.argv.includes("--mudo");

const opcoes = {
  host: MQTT_HOST,
  port: Number(MQTT_PORT || 8883),
  protocol: "mqtts",
  username: ESP32_USER,
  password: ESP32_PASS,
  clientId: "petsync-simulador-" + Math.random().toString(16).slice(2, 8),
};
if (MQTT_CA) opcoes.ca = fs.readFileSync(MQTT_CA);

const jaFeitos = new Set();
const client = mqtt.connect(opcoes);

client.on("connect", () => {
  console.log(`ESP32 simulado conectado${mudo ? " (mudo: não responde a pedidos)" : ""}.`);
  client.subscribe(["petsync/racao/liberar", "petsync/config"], { qos: 1 }, (err, granted) => {
    if (err) return console.error("Erro ao assinar:", err.message);
    for (const g of granted) console.log(g.qos === 128 ? `NEGADO: ${g.topic}` : `Assinado: ${g.topic}`);
  });
});

client.on("message", (topico, payload, packet) => {
  let m;
  try { m = JSON.parse(payload.toString()); } catch { return console.log("JSON inválido em", topico); }

  if (topico === "petsync/config") {
    console.log(`CONFIG recebida (retained=${packet.retain}):`, m);
    return;
  }

  console.log("PEDIDO recebido:", m);
  if (mudo) return console.log("Modo mudo: não vou responder.");

  const duplicado = jaFeitos.has(m.cmd_id);
  jaFeitos.add(m.cmd_id);

  setTimeout(() => {
    const resp = {
      cmd_id: m.cmd_id,
      origem: m.origem,
      meta_g: m.quantidade_g,
      status: duplicado ? "duplicado" : "executado",
      peso_antes_g: duplicado ? null : 12.0,
      peso_depois_g: duplicado ? null : m.quantidade_g + 0.5,
      motivo: null,
      ts: Math.floor(Date.now() / 1000),
    };
    client.publish("petsync/racao/confirmacao", JSON.stringify(resp), { qos: 1 });
    console.log(`Confirmação enviada: ${resp.status}.`);
  }, 2000);
});

client.on("error", (e) => console.error("Erro:", e.message));