const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const chave = require("./chave-admin.json");

initializeApp({ credential: cert(chave) });
const db = getFirestore();

const id = process.argv[2];
const statusInicial = process.argv[3] || "enviado";
const quantidade = Number(process.argv[4] || 150);
if (!id) {
  console.error("Uso: node criar-comando-teste.js ID_DO_PEDIDO");
  process.exit(1);
}

db.collection("comandos")
  .doc(id)
  .set({
    quantidade_g: quantidade,
    criado_em: Timestamp.now(),
    criado_por: "teste",
    status: statusInicial,
    motivo: null,
    atualizado_em: Timestamp.now(),
    ficticio: true,
  })
  .then(() => console.log(`comandos/${id} criado com status "enviado".`))
  .catch((e) => {
    console.error("Erro:", e.message);
    process.exit(1);
  });