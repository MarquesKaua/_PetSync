require("dotenv").config();
const fs = require("fs");
const mqtt = require("mqtt");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const chave = require("./chave-admin.json");

initializeApp({ credential: cert(chave) });
const db = getFirestore();

const rapido = process.argv.includes("--rapido");
const simulado = process.argv.includes("--simulado");
const ESTADO_MS = (rapido ? 5 : 30) * 1000;
const LEITURA_MS = (rapido ? 20 : 300) * 1000;

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

// Memória: última leitura de cada sensor
const ultimo = { agua: null, racao: null };
let vistoEm = null;
let pendenteEstado = false;
let pendenteLeitura = false;

// ts do ESP32 (segundos) -> Timestamp. Se vier absurdo, usa a hora do servidor.
function paraTimestamp(ts) {
  const ms = Number(ts) * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms - Date.now()) > 24 * 3600 * 1000) {
    return Timestamp.now();
  }
  return Timestamp.fromMillis(ms);
}

// Validação do contrato: devolve o objeto pronto pro Firestore, ou null
function lerAgua(m) {
  if (!m || typeof m.valido !== "boolean") return null;
  if (m.valido && (typeof m.nivel_pct !== "number" || m.nivel_pct < 0 || m.nivel_pct > 100)) {
    return null;
  }
  return {
    nivel_pct: m.valido ? m.nivel_pct : null,
    valido: m.valido,
    atualizado_em: paraTimestamp(m.ts),
  };
}

function lerRacao(m) {
  if (!m || typeof m.valido !== "boolean") return null;
  if (
    m.valido &&
    (typeof m.peso_g !== "number" || typeof m.nivel_pct !== "number" || m.peso_g < 0)
  ) {
    return null;
  }
  return {
    peso_g: m.valido ? m.peso_g : null,
    nivel_pct: m.valido ? m.nivel_pct : null,
    valido: m.valido,
    atualizado_em: paraTimestamp(m.ts),
  };
}

async function gravarEstado() {
  if (!pendenteEstado) return;
  pendenteEstado = false;
  const dados = { dispositivo: { online: true, visto_em: vistoEm } };
  if (ultimo.agua) dados.agua = ultimo.agua;
  if (ultimo.racao) dados.racao = ultimo.racao;
  try {
    await db.collection("estado").doc("atual").set(dados, { merge: true });
    console.log("estado/atual gravado.");
  } catch (e) {
    pendenteEstado = true;
    console.error("Erro ao gravar estado:", e.message);
  }
}

async function gravarLeitura() {
  if (!pendenteLeitura || (!ultimo.agua && !ultimo.racao)) return;
  pendenteLeitura = false;
  const a = ultimo.agua;
  const r = ultimo.racao;
  const ficha = {
    ts: Timestamp.now(),
    agua_pct: a && a.valido ? a.nivel_pct : null,
    agua_valida: a ? a.valido : false,
    racao_g: r && r.valido ? r.peso_g : null,
    racao_pct: r && r.valido ? r.nivel_pct : null,
    racao_valida: r ? r.valido : false,
  };
  if (simulado) ficha.ficticio = true;
  try {
    await db.collection("leituras").add(ficha);
    console.log("leituras: ficha nova gravada.");
  } catch (e) {
    pendenteLeitura = true;
    console.error("Erro ao gravar leitura:", e.message);
  }
}

const STATUS_VALIDOS = ["executado", "duplicado", "expirado", "rejeitado", "falhou"];

function lerConfirmacao(m) {
  if (!m || typeof m.cmd_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(m.cmd_id)) return null;
  if (!["manual", "agendado"].includes(m.origem)) return null;
  if (!STATUS_VALIDOS.includes(m.status)) return null;
  if (typeof m.meta_g !== "number" || m.meta_g <= 0) return null;

  const num = (v) => (typeof v === "number" && v >= 0 ? v : null);
  const antes = num(m.peso_antes_g);
  const depois = num(m.peso_depois_g);
  const liberado =
    antes !== null && depois !== null
      ? Math.max(0, Math.round((depois - antes) * 10) / 10)
      : 0;

  return {
    cmd_id: m.cmd_id,
    ficha: {
      ts: paraTimestamp(m.ts),
      origem: m.origem,
      meta_g: m.meta_g,
      peso_antes_g: antes,
      peso_depois_g: depois,
      liberado_g: liberado,
      status: m.status,
      motivo: typeof m.motivo === "string" ? m.motivo : null,
    },
  };
}

async function processarConfirmacao({ cmd_id, ficha }) {
  if (ficha.status === "duplicado") {
    console.log(`Confirmação ${cmd_id}: o ESP32 respondeu "duplicado". Nada a gravar, o registro original já existe.`);
    return;
  }

  const refAlim = db.collection("alimentacoes").doc(cmd_id);
  const refCmd = db.collection("comandos").doc(cmd_id);
  const refEstoque = db.collection("estoque").doc("atual");

  const resumo = await db.runTransaction(async (t) => {
    const [alim, cmd, estoque] = await t.getAll(refAlim, refCmd, refEstoque);

    if (alim.exists) return null; // confirmação repetida

    t.set(refAlim, simulado ? { ...ficha, ficticio: true } : ficha);

    if (cmd.exists) {
      t.update(refCmd, {
        status: ficha.status,
        motivo: ficha.motivo,
        atualizado_em: Timestamp.now(),
      });
    }

    let estoqueMsg = "sem desconto no estoque";
    if (ficha.status === "executado" && ficha.liberado_g > 0) {
      if (estoque.exists) {
        const antes = estoque.data().estimado_g;
        const depois = Math.max(0, antes - ficha.liberado_g);
        t.update(refEstoque, { estimado_g: depois, atualizado_em: Timestamp.now() });
        estoqueMsg = `estoque ${antes} -> ${depois} g`;
      } else {
        estoqueMsg = "estoque/atual não existe, sem desconto";
      }
    }
    return `${ficha.status}, ${estoqueMsg}${cmd.exists ? "" : "; sem pedido em comandos (normal nas agendadas)"}`;
  });

  console.log(
    resumo === null
      ? `Confirmação ${cmd_id} repetida: ignorada, sem descontar de novo.`
      : `alimentacoes/${cmd_id} gravada: ${resumo}.`
  );
}


const client = mqtt.connect(opcoes);

client.on("connect", () => {
  console.log("Conectado ao broker.");
  for (const t of ["petsync/agua/nivel", "petsync/racao/nivel", "petsync/racao/confirmacao"]) {
    client.subscribe(t, { qos: 1 }, (err, granted) => {
      const negado = err || (granted && granted[0] && granted[0].qos === 128);
      console.log(negado ? `NEGADO: ${t}` : `Assinado: ${t}`);
    });
  }
});

client.on("message", (topico, payload) => {
  let m;
  try {
    m = JSON.parse(payload.toString());
  } catch {
    console.log(`Descartado: JSON inválido em ${topico}.`);
    return;
  }

  contatoDoDispositivo();

  if (topico === "petsync/agua/nivel") {
    const l = lerAgua(m);
    if (!l) return console.log("Descartado: leitura de água fora do contrato.");
    ultimo.agua = l;
    avaliarSensor("agua", l);
    avaliarAgua(l);
  } else if (topico === "petsync/racao/nivel") {
    const l = lerRacao(m);
    if (!l) return console.log("Descartado: leitura de ração fora do contrato.");
    ultimo.racao = l;
    avaliarSensor("racao", l);
  } else if (topico === "petsync/racao/confirmacao") {
    const c = lerConfirmacao(m);
    if (!c) return console.log("Descartado: confirmação fora do contrato.");
    processarConfirmacao(c).catch((e) =>
      console.error("Erro ao processar confirmação:", e.message)
    );
    return;
  } else {
    return;
  }

  vistoEm = Timestamp.now();
  pendenteEstado = true;
  pendenteLeitura = true;
});

// ===== N4: comandos e config =====
const LIMITE_PADRAO_G = 400;
const IDADE_MAX_MS = 2 * 60 * 1000;
const RESPOSTA_MS = (rapido ? 10 : 30) * 1000;

let ultimaConfig = null;
let publicandoConfig = false;

async function mudarStatusComando(id, deQuem, status, motivo) {
  const ref = db.collection("comandos").doc(id);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists && s.data().status === deQuem) {
      t.update(ref, { status, motivo, atualizado_em: Timestamp.now() });
    }
  });
}

async function processarComando(doc) {
  const id = doc.id;
  const ref = doc.ref;

  // Reivindica o pedido: só quem ainda o vê como "pendente" segue em frente
  const resultado = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists || s.data().status !== "pendente") return null;
    const d = s.data();
    const limite = (ultimaConfig && ultimaConfig.limite_diario_g) || LIMITE_PADRAO_G;

    let status = "enviado";
    let motivo = null;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      status = "rejeitado"; motivo = "Identificador do pedido inválido";
    } else if (typeof d.quantidade_g !== "number" || d.quantidade_g <= 0 || d.quantidade_g > limite) {
      status = "rejeitado"; motivo = "Quantidade inválida";
    } else if (!d.criado_em || typeof d.criado_em.toMillis !== "function") {
      status = "rejeitado"; motivo = "Pedido sem data de criação";
    } else if (Date.now() - d.criado_em.toMillis() > IDADE_MAX_MS) {
      status = "expirado"; motivo = "Pedido velho demais";
    } else if (!client.connected) {
      status = "falhou"; motivo = "Serviço sem conexão com o broker";
    }

    t.update(ref, { status, motivo, atualizado_em: Timestamp.now() });
    return { status, motivo, d };
  });

  if (!resultado) return;
  if (resultado.status !== "enviado") {
    console.log(`comandos/${id}: ${resultado.status} (${resultado.motivo}).`);
    return;
  }

  const msg = {
    cmd_id: id,
    quantidade_g: resultado.d.quantidade_g,
    origem: "manual",
    ts: Math.floor(resultado.d.criado_em.toMillis() / 1000),
  };
  client.publish("petsync/racao/liberar", JSON.stringify(msg), { qos: 1 }, (err) => {
    if (err) {
      console.error(`Erro ao publicar ${id}:`, err.message);
      mudarStatusComando(id, "enviado", "falhou", "Falha ao enviar ao broker").catch(() => {});
    } else {
      console.log(`comandos/${id}: enviado ao ESP32 (meta ${msg.quantidade_g} g).`);
    }
  });

  setTimeout(() => {
    mudarStatusComando(id, "enviado", "sem_resposta", "O dispositivo não respondeu a tempo")
      .then(() => {})
      .catch((e) => console.error("Erro ao marcar sem_resposta:", e.message));
  }, RESPOSTA_MS);
}

function configValida(c) {
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  return (
    c &&
    typeof c.porcao_g === "number" && c.porcao_g > 0 &&
    typeof c.limite_diario_g === "number" && c.limite_diario_g >= c.porcao_g &&
    Array.isArray(c.horarios) && c.horarios.length >= 1 && c.horarios.length <= 6 &&
    c.horarios.every((h) => typeof h === "string" && hora.test(h)) &&
    c.agua &&
    typeof c.agua.nivel_minimo_pct === "number" &&
    typeof c.agua.nivel_alvo_pct === "number" &&
    c.agua.nivel_minimo_pct >= 0 &&
    c.agua.nivel_minimo_pct < c.agua.nivel_alvo_pct &&
    c.agua.nivel_alvo_pct <= 100
  );
}

async function publicarConfigSeNecessario() {
  if (!ultimaConfig || !client.connected || publicandoConfig) return;
  const c = ultimaConfig;
  if (!c.atualizado_em) return;
  if (c.publicada_atualizado_em && c.publicada_atualizado_em.toMillis() === c.atualizado_em.toMillis()) {
    return; // já publicada
  }
  if (!configValida(c)) {
    console.log("Config inválida: não publicada. Corrija no site.");
    return;
  }

  publicandoConfig = true;
  try {
    const versao = (c.versao || 0) + 1;
    const msg = {
      versao,
      porcao_g: c.porcao_g,
      limite_diario_g: c.limite_diario_g,
      horarios: c.horarios,
      agua: {
        nivel_minimo_pct: c.agua.nivel_minimo_pct,
        nivel_alvo_pct: c.agua.nivel_alvo_pct,
      },
      ts: Math.floor(Date.now() / 1000),
    };
    await new Promise((ok, falha) =>
      client.publish("petsync/config", JSON.stringify(msg), { qos: 1, retain: true }, (e) =>
        e ? falha(e) : ok()
      )
    );
    await db.collection("config").doc("atual").update({
      versao,
      publicada_atualizado_em: c.atualizado_em,
    });
    console.log(`config publicada (retained), versão ${versao}.`);
  } catch (e) {
    console.error("Erro ao publicar config:", e.message);
  } finally {
    publicandoConfig = false;
  }
}

function iniciarN4() {
  // Pedidos novos do app
  db.collection("comandos")
    .where("status", "==", "pendente")
    .onSnapshot(
      (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === "added") {
            processarComando(ch.doc).catch((e) =>
              console.error("Erro ao processar comando:", e.message)
            );
          }
        }
      },
      (e) => console.error("Erro ao ouvir comandos:", e.message)
    );

  // Config editada no site
  db.collection("config")
    .doc("atual")
    .onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        ultimaConfig = snap.data();
        publicarConfigSeNecessario();
      },
      (e) => console.error("Erro ao ouvir config:", e.message)
    );

  // Pedidos que ficaram "enviado" enquanto o serviço estava parado
  db.collection("comandos")
    .where("status", "==", "enviado")
    .get()
    .then((snap) => {
      for (const d of snap.docs) {
        const quando = d.data().atualizado_em;
        if (quando && Date.now() - quando.toMillis() > RESPOSTA_MS) {
          mudarStatusComando(d.id, "enviado", "sem_resposta", "O dispositivo não respondeu a tempo").catch(() => {});
        }
      }
    })
    .catch((e) => console.error("Erro na limpeza inicial:", e.message));
}

client.once("connect", iniciarN4);
client.on("connect", publicarConfigSeNecessario);

// ===== N5: alertas e dispositivo offline =====
const OFFLINE_MS = (rapido ? 20 : 120) * 1000;
const AGUA_BAIXA_MS = (rapido ? 30 : 600) * 1000;
const LIMITE_INVALIDAS = 3;

const abertos = new Set();
const resolvendo = new Set();
let ultimoContatoMs = Date.now();
let dispositivoOffline = false;
const invalidas = { agua: 0, racao: 0 };
let aguaAbaixoDesde = null;
let estoqueG = null;
let limiteEstoqueG = null;
let minimoAguaPct = null;

async function abrirAlerta(tipo, mensagem) {
  if (abertos.has(tipo)) return;
  abertos.add(tipo);
  try {
    const criou = await db.runTransaction(async (t) => {
      const q = db.collection("alertas").where("tipo", "==", tipo).where("ativo", "==", true);
      const s = await t.get(q);
      if (!s.empty) return false;
      const ficha = { tipo, mensagem, criado_em: Timestamp.now(), ativo: true, resolvido_em: null };
      if (simulado) ficha.ficticio = true;
      t.set(db.collection("alertas").doc(), ficha);
      return true;
    });
    if (criou) console.log(`ALERTA aberto: ${tipo}.`);
  } catch (e) {
    abertos.delete(tipo);
    console.error(`Erro ao abrir alerta ${tipo}:`, e.message);
  }
}

async function resolverAlerta(tipo) {
  if (!abertos.has(tipo) || resolvendo.has(tipo)) return;
  resolvendo.add(tipo);
  try {
    const s = await db.collection("alertas").where("tipo", "==", tipo).where("ativo", "==", true).get();
    if (!s.empty) {
      const batch = db.batch();
      s.docs.forEach((d) => batch.update(d.ref, { ativo: false, resolvido_em: Timestamp.now() }));
      await batch.commit();
      console.log(`ALERTA resolvido: ${tipo}.`);
    }
    abertos.delete(tipo);
  } catch (e) {
    console.error(`Erro ao resolver alerta ${tipo}:`, e.message);
  } finally {
    resolvendo.delete(tipo);
  }
}

function contatoDoDispositivo() {
  ultimoContatoMs = Date.now();
  if (dispositivoOffline) {
    dispositivoOffline = false;
    console.log("Dispositivo voltou.");
    db.collection("estado")
      .doc("atual")
      .set({ dispositivo: { online: true, visto_em: Timestamp.now() } }, { merge: true })
      .catch((e) => console.error("Erro ao marcar online:", e.message));
    resolverAlerta("esp32_offline");
  }
}

function verificarOffline() {
  if (dispositivoOffline || !client.connected) return;
  if (Date.now() - ultimoContatoMs > OFFLINE_MS) {
    dispositivoOffline = true;
    console.log("Dispositivo offline.");
    db.collection("estado")
      .doc("atual")
      .set({ dispositivo: { online: false } }, { merge: true })
      .catch((e) => console.error("Erro ao marcar offline:", e.message));
    abrirAlerta("esp32_offline", "Dispositivo sem comunicação com o servidor.");
  }
}

function avaliarSensor(nome, leitura) {
  invalidas[nome] = leitura.valido ? 0 : invalidas[nome] + 1;
  if (invalidas[nome] >= LIMITE_INVALIDAS) {
    abrirAlerta(
      "sensor_invalido",
      `Sensor de ${nome === "agua" ? "água" : "ração"} com leituras inválidas seguidas.`
    );
  } else if (invalidas.agua === 0 && invalidas.racao === 0) {
    resolverAlerta("sensor_invalido");
  }
}

function avaliarAgua(leitura) {
  if (!leitura.valido || minimoAguaPct === null) return;
  if (leitura.nivel_pct < minimoAguaPct) {
    if (aguaAbaixoDesde === null) {
      aguaAbaixoDesde = Date.now();
    } else if (Date.now() - aguaAbaixoDesde >= AGUA_BAIXA_MS) {
      abrirAlerta(
        "agua_baixa",
        `Água abaixo de ${minimoAguaPct}% há um bom tempo. O enchimento pode não estar funcionando.`
      );
    }
  } else {
    aguaAbaixoDesde = null;
    resolverAlerta("agua_baixa");
  }
}

function avaliarEstoque() {
  if (typeof estoqueG !== "number" || typeof limiteEstoqueG !== "number") return;
  if (estoqueG <= limiteEstoqueG) {
    abrirAlerta(
      "estoque_racao_baixo",
      `Ração acabando no reservatório (~${Math.round(estoqueG)} g). Reabasteça.`
    );
  } else {
    resolverAlerta("estoque_racao_baixo");
  }
}

function iniciarN5() {
  // Mantém a lista local de alertas ativos em sincronia com o banco
  db.collection("alertas")
    .where("ativo", "==", true)
    .onSnapshot(
      (snap) => {
        abertos.clear();
        snap.docs.forEach((d) => abertos.add(d.data().tipo));
      },
      (e) => console.error("Erro ao ouvir alertas:", e.message)
    );

  db.collection("estoque")
    .doc("atual")
    .onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        estoqueG = snap.data().estimado_g;
        avaliarEstoque();
      },
      (e) => console.error("Erro ao ouvir estoque:", e.message)
    );

  db.collection("config")
    .doc("atual")
    .onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const c = snap.data();
        limiteEstoqueG = c.alerta_racao_baixa_g;
        minimoAguaPct = c.agua ? c.agua.nivel_minimo_pct : null;
        avaliarEstoque();
      },
      (e) => console.error("Erro ao ouvir config:", e.message)
    );

  setInterval(verificarOffline, (rapido ? 5 : 15) * 1000);
}

// Ao (re)conectar no broker, dá um tempo de tolerância antes de declarar offline
client.on("connect", () => {
  ultimoContatoMs = Date.now();
});
client.once("connect", iniciarN5);

setInterval(gravarEstado, ESTADO_MS);
setInterval(gravarLeitura, LEITURA_MS);

client.on("error", (e) => console.error("Erro MQTT:", e.message));
client.on("reconnect", () => console.log("Reconectando..."));
client.on("close", () => console.log("Conexão fechada."));

console.log(
  `Serviço iniciado. estado a cada ${ESTADO_MS / 1000}s, leituras a cada ${LEITURA_MS / 1000}s` +
    (simulado ? " (leituras marcadas como fictícias)." : ".")
);