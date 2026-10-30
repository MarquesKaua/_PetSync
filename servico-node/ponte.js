require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");

const { MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASS, MQTT_CA } = process.env;

if (!MQTT_HOST || !MQTT_USER || !MQTT_PASS) {
  console.error("Faltam variáveis no .env (MQTT_HOST, MQTT_USER, MQTT_PASS).");
  process.exit(1);
}

const opcoes = {
  host: MQTT_HOST,
  port: Number(MQTT_PORT || 8883),
  protocol: "mqtts",
  username: MQTT_USER,
  password: MQTT_PASS,
  clientId: "petsync-node-" + Math.random().toString(16).slice(2, 8),
  reconnectPeriod: 5000,
};
if (MQTT_CA) opcoes.ca = fs.readFileSync(MQTT_CA);

const TOPICOS = [
  "petsync/agua/nivel",
  "petsync/racao/nivel",
  "petsync/racao/confirmacao",
];

const testarAcl = process.argv.includes("--testar-acl");
const MARCA = "forjado-" + Date.now();

const client = mqtt.connect(opcoes);

client.on("connect", () => {
  console.log("Conectado ao broker.");
  let pendentes = TOPICOS.length;
  for (const t of TOPICOS) {
    client.subscribe(t, { qos: 1 }, (err, granted) => {
      const negado = err || (granted && granted[0] && granted[0].qos === 128);
      console.log(negado ? `NEGADO: ${t}` : `Assinado: ${t}`);
      pendentes--;
      if (pendentes === 0 && testarAcl) {
        console.log("Teste: publicando em petsync/agua/nivel como 'node' (deveria ser barrado)...");
        client.publish("petsync/agua/nivel", JSON.stringify({ teste: MARCA }), { qos: 0 });
        setTimeout(() => {
          console.log("Teste concluído. Se não apareceu 'FALHA' acima, o broker barrou.");
          client.end();
        }, 4000);
      }
    });
  }
});

client.on("message", (topico, payload) => {
  const texto = payload.toString();
  if (testarAcl && texto.includes(MARCA)) {
    console.log("FALHA: o broker deixou o node publicar em petsync/agua/nivel.");
    return;
  }
  try {
    console.log(`[${topico}]`, JSON.parse(texto));
  } catch {
    console.log(`[${topico}] JSON inválido: ${texto}`);
  }
});

client.on("error", (e) => console.error("Erro:", e.message));
client.on("reconnect", () => console.log("Reconectando..."));
client.on("close", () => console.log("Conexão fechada."));