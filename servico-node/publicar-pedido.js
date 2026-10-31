require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");

const { MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASS, MQTT_CA } = process.env;
const [, , id, qtd, idade] = process.argv;

if (!id || !qtd) {
  console.error("Uso: node publicar-pedido.js ID QUANTIDADE_G [IDADE_EM_SEGUNDOS]");
  process.exit(1);
}

const opcoes = {
  host: MQTT_HOST,
  port: Number(MQTT_PORT || 8883),
  protocol: "mqtts",
  username: MQTT_USER,
  password: MQTT_PASS,
  clientId: "petsync-teste-" + Math.random().toString(16).slice(2, 8),
};
if (MQTT_CA) opcoes.ca = fs.readFileSync(MQTT_CA);

const client = mqtt.connect(opcoes);
client.on("connect", () => {
  const msg = {
    cmd_id: id,
    quantidade_g: Number(qtd),
    origem: "manual",
    ts: Math.floor(Date.now() / 1000) - Number(idade || 0),
  };
  client.publish("petsync/racao/liberar", JSON.stringify(msg), { qos: 1 }, (err) => {
    console.log(err ? "Erro: " + err.message : "Publicado: " + JSON.stringify(msg));
    client.end();
  });
});
client.on("error", (e) => console.error("Erro:", e.message));