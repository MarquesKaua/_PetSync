require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");

const { MQTT_HOST, MQTT_PORT, ESP32_USER, ESP32_PASS, MQTT_CA } = process.env;
if (!MQTT_HOST || !ESP32_USER || !ESP32_PASS) {
  console.error("Faltam variáveis no .env (MQTT_HOST, ESP32_USER, ESP32_PASS).");
  process.exit(1);
}

const argAgua = process.argv.find((a) => a.startsWith("--agua="));
const aguaFixa = argAgua ? Number(argAgua.split("=")[1]) : null;
const forcarInvalida = process.argv.includes("--agua-invalida");

const opcoes = {
  host: MQTT_HOST,
  port: Number(MQTT_PORT || 8883),
  protocol: "mqtts",
  username: ESP32_USER,
  password: ESP32_PASS,
  clientId: "petsync-simulador-" + Math.random().toString(16).slice(2, 8),
};
if (MQTT_CA) opcoes.ca = fs.readFileSync(MQTT_CA);

const client = mqtt.connect(opcoes);
let agua = aguaFixa !== null ? aguaFixa : 70;
let peso = 40;

client.on("connect", () => {
  console.log("Simulador conectado. Publicando a cada 2 s (Ctrl + C para parar).");
  setInterval(() => {
    if (aguaFixa !== null) {
      agua = aguaFixa + (Math.random() * 2 - 1);
    } else {
      agua = Math.min(95, Math.max(20, agua + (Math.random() * 4 - 2.2)));
    }
    agua = Math.min(100, Math.max(0, agua));
    peso = Math.min(160, Math.max(0, peso + (Math.random() * 6 - 3)));

    const aguaInvalida = forcarInvalida || Math.random() < 0.05;
    const ts = Math.floor(Date.now() / 1000);

    client.publish(
      "petsync/agua/nivel",
      JSON.stringify({
        nivel_pct: aguaInvalida ? null : Math.round(agua),
        distancia_cm: aguaInvalida ? -1 : Math.round(((100 - agua) / 10) * 10) / 10,
        valido: !aguaInvalida,
        ts,
      })
    );
    client.publish(
      "petsync/racao/nivel",
      JSON.stringify({
        peso_g: Math.round(peso * 10) / 10,
        porcao_alvo_g: 150,
        nivel_pct: Math.round((peso / 150) * 100),
        valido: true,
        ts,
      })
    );
    console.log(
      `enviado: água ${aguaInvalida ? "inválida" : Math.round(agua) + "%"}, ração ${peso.toFixed(1)} g`
    );
  }, 2000);
});

client.on("error", (e) => console.error("Erro:", e.message));