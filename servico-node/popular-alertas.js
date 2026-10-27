const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const chave = require("./chave-admin.json");

initializeApp({ credential: cert(chave) });
const db = getFirestore();

const horasAtras = (h) => Timestamp.fromMillis(Date.now() - h * 60 * 60 * 1000);

const alertas = [
  {
    tipo: "estoque_racao_baixo",
    mensagem: "Ração acabando no reservatório. Reabasteça.",
    criado_em: horasAtras(2),
    ativo: true,
    resolvido_em: null,
  },
  {
    tipo: "agua_baixa",
    mensagem: "Nível de água baixo na tigela.",
    criado_em: horasAtras(30),
    ativo: false,
    resolvido_em: horasAtras(29),
  },
  {
    tipo: "esp32_offline",
    mensagem: "Dispositivo sem comunicação por mais de 2 minutos.",
    criado_em: horasAtras(50),
    ativo: false,
    resolvido_em: horasAtras(49),
  },
];

async function main() {
  const batch = db.batch();
  for (const a of alertas) {
    batch.set(db.collection("alertas").doc(), { ...a, ficticio: true });
  }
  await batch.commit();
  console.log(`Pronto: ${alertas.length} alertas gravados.`);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});