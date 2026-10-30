require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");

const { MQTT_HOST, MQTT_PORT, ESP32_USER, ESP32_PASS, MQTT_CA } = process.env;

if (!MQTT_HOST || !ESP32_USER || !ESP32_PASS) {
  console.error("Faltam variáveis no .env (MQTT_HOST, ESP32_USER, ESP32_PASS).");
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

const MARCA = "forjado-" + Date.now();
const client = mqtt.connect(opcoes);

client.on("connect", () => {
  console.log("Simulador conectado como esp32.");
  client.subscribe(["petsync/racao/liberar", "petsync/config"], { qos: 1 }, (err, granted) => {
    if (err) {
      console.error("Erro ao assinar:", err.message);
      return;
    }
    for (const g of granted) {
      console.log(g.qos === 128 ? `NEGADO: ${g.topic}` : `Assinado: ${g.topic}`);
    }

    const agora = Math.floor(Date.now() / 1000);
    client.publish(
      "petsync/agua/nivel",
      JSON.stringify({ nivel_pct: 72, distancia_cm: 4.3, valido: true, ts: agora })
    );
    client.publish(
      "petsync/racao/nivel",
      JSON.stringify({ peso_g: 38.5, porcao_alvo_g: 150, nivel_pct: 26, valido: true, ts: agora })
    );
    console.log("Publicadas: água e ração (permitido).");

    console.log("Teste: publicando em petsync/racao/liberar como esp32 (deveria ser barrado)...");
    client.publish("petsync/racao/liberar", JSON.stringify({ teste: MARCA }));

    setTimeout(() => {
      console.log("Fim do teste. Se não apareceu 'FALHA' acima, o broker barrou.");
      client.end();
    }, 4000);
  });
});

client.on("message", (topico, payload) => {
  if (payload.toString().includes(MARCA)) {
    console.log("FALHA: o broker deixou o esp32 publicar em petsync/racao/liberar.");
  } else {
    console.log(`[${topico}]`, payload.toString());
  }
});

client.on("error", (e) => console.error("Erro:", e.message));
client.on("close", () => console.log("Conexão fechada."));