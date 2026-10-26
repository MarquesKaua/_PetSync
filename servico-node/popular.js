const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const chave = require("./chave-admin.json");

initializeApp({ credential: cert(chave) });
const db = getFirestore();

const DIAS = 3;
const PASSO_MIN = 30;
const REFEICOES = [8, 19];
const agora = new Date();
const inicio = new Date(agora.getTime() - DIAS * 24 * 60 * 60 * 1000);

const r1 = (n) => Math.round(n * 10) / 10;
const pad = (n) => String(n).padStart(2, "0");

function racaoNoPote(t) {
  const h = t.getHours() + t.getMinutes() / 60;
  let minDesdeRefeicao;
  if (h >= 19) minDesdeRefeicao = (h - 19) * 60;
  else if (h >= 8) minDesdeRefeicao = (h - 8) * 60;
  else minDesdeRefeicao = (h + 24 - 19) * 60;
  return Math.max(0, 150 - minDesdeRefeicao * 1.2);
}

async function main() {
  const batch = db.batch();
  let nLeituras = 0;
  let nAlim = 0;

  // Leituras a cada 30 min
  let i = 0;
  for (let t = new Date(inicio); t <= agora; t = new Date(t.getTime() + PASSO_MIN * 60000)) {
    const aguaValida = i % 40 !== 39; // 1 leitura inválida de vez em quando
    const agua = 80 - (i % 36) * (40 / 36) + (Math.random() * 2 - 1);
    const racao = racaoNoPote(t) + (Math.random() * 2 - 1);
    const racaoG = Math.max(0, r1(racao));

    batch.set(db.collection("leituras").doc(), {
      ts: Timestamp.fromDate(t),
      agua_pct: aguaValida ? Math.round(agua) : null,
      agua_valida: aguaValida,
      racao_g: racaoG,
      racao_pct: Math.round((racaoG / 150) * 100),
      racao_valida: true,
      ficticio: true,
    });
    nLeituras++;
    i++;
  }

  // Alimentações: 2 por dia
  for (let d = 0; d <= DIAS; d++) {
    for (const hora of REFEICOES) {
      const t = new Date(inicio);
      t.setDate(t.getDate() + d);
      t.setHours(hora, 0, 12, 0);
      if (t > agora || t < inicio) continue;

      const id = `ag-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}-${pad(hora)}00`;
      const antes = r1(Math.random() * 10);
      const falhou = nAlim === 2; // uma falha de exemplo
      const depois = falhou ? antes : r1(150 + Math.random() * 1.5);

      batch.set(db.collection("alimentacoes").doc(id), {
        ts: Timestamp.fromDate(t),
        origem: "agendado",
        meta_g: 150,
        peso_antes_g: antes,
        peso_depois_g: depois,
        liberado_g: r1(depois - antes),
        status: falhou ? "falhou" : "executado",
        motivo: falhou ? "Ração travou no dispensador" : null,
        ficticio: true,
      });
      nAlim++;
    }
  }

  await batch.commit();
  console.log(`Pronto: ${nLeituras} leituras e ${nAlim} alimentações gravadas.`);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});