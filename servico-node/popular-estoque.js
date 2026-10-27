const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const chave = require("./chave-admin.json");

initializeApp({ credential: cert(chave) });
const db = getFirestore();

const horasAtras = (h) => Timestamp.fromMillis(Date.now() - h * 60 * 60 * 1000);

async function main() {
  const atual = db.collection("estoque").doc("atual");
  const batch = db.batch();

  // Situação de agora: ~400 g, coerente com o alerta "ração acabando"
  batch.set(atual, {
    estimado_g: 400,
    atualizado_em: horasAtras(1),
    ultimo_abastecimento_em: horasAtras(48),
    ficticio: true,
  });

  // Histórico: um "adicionei" e um "ajustei"
  batch.set(atual.collection("abastecimentos").doc("fic-1"), {
    ts: horasAtras(120),
    tipo: "adicionei",
    quantidade_g: 3000,
    estimado_antes_g: 120,
    estimado_depois_g: 3120,
    por: "ficticio",
    ficticio: true,
  });

  batch.set(atual.collection("abastecimentos").doc("fic-2"), {
    ts: horasAtras(48),
    tipo: "ajustei",
    quantidade_g: 1000,
    estimado_antes_g: 1500,
    estimado_depois_g: 1000,
    por: "ficticio",
    ficticio: true,
  });

  await batch.commit();
  console.log("Pronto: estoque/atual e 2 abastecimentos gravados.");
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});