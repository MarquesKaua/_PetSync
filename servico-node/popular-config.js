const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const chave = require("./chave-admin.json");

initializeApp({ credential: cert(chave) });
const db = getFirestore();

async function main() {
  await db.collection("config").doc("atual").set({
    versao: 1,
    porcao_g: 150,
    limite_diario_g: 400,
    horarios: ["08:00", "19:00"],
    agua: { nivel_minimo_pct: 40, nivel_alvo_pct: 80 },
    alerta_racao_baixa_g: 500,
    atualizado_em: Timestamp.now(),
  });
  console.log("Pronto: config/atual criada.");
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});