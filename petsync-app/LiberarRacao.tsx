import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from "react-native";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

function novoId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function mensagem(status: string | null, motivo: string | null) {
  switch (status) {
    case null:
    case "pendente":
      return { texto: "Enviando o pedido...", cor: "#555" };
    case "enviado":
      return { texto: "Aguardando o dispositivo...", cor: "#555" };
    case "executado":
      return { texto: "Ração liberada ✅", cor: "#2e7d32" };
    case "rejeitado":
      return { texto: `Recusado: ${motivo ?? "sem motivo informado"}`, cor: "#c62828" };
    case "expirado":
      return { texto: "Pedido expirado (demorou demais).", cor: "#c62828" };
    case "falhou":
      return { texto: `Falhou: ${motivo ?? "erro no dispositivo"}`, cor: "#c62828" };
    case "sem_resposta":
      return { texto: "O dispositivo não respondeu. Confere se está ligado.", cor: "#c62828" };
    default:
      return { texto: status, cor: "#555" };
  }
}

export default function LiberarRacao() {
  const [qtd, setQtd] = useState("");
  const [cmdId, setCmdId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Sugere a porção da config
  useEffect(() => {
    getDoc(doc(db, "config", "atual"))
      .then((snap) => {
        if (snap.exists()) setQtd(String(snap.data().porcao_g));
      })
      .catch(() => {});
  }, []);

  // Acompanha o pedido ao vivo
  useEffect(() => {
    if (!cmdId) return;
    const parar = onSnapshot(doc(db, "comandos", cmdId), (snap) => {
      if (!snap.exists()) return;
      const x = snap.data();
      setStatus(x.status ?? null);
      setMotivo(x.motivo ?? null);
    });
    return parar;
  }, [cmdId]);

  const emAndamento = cmdId !== null && (status === null || status === "pendente" || status === "enviado");

  function pedirConfirmacao() {
    const n = Math.round(Number(qtd));
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert("Quantidade inválida", "Digite um valor em gramas, maior que zero.");
      return;
    }
    Alert.alert("Liberar ração", `Completar o pote até ${n} g?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Liberar", onPress: () => enviar(n) },
    ]);
  }

  async function enviar(n: number) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const id = novoId();
    setEnviando(true);
    setStatus(null);
    setMotivo(null);
    try {
      await setDoc(doc(db, "comandos", id), {
        quantidade_g: n,
        criado_em: serverTimestamp(),
        criado_por: uid,
        status: "pendente",
        motivo: null,
        atualizado_em: serverTimestamp(),
      });
      setCmdId(id);
    }    catch (e: any) {
      Alert.alert("Erro", String(e?.code ?? e?.message ?? e));
    }
    setEnviando(false);
  }

  const m = cmdId ? mensagem(status, motivo) : null;

  return (
    <View style={estilos.cartao}>
      <Text style={estilos.titulo}>Liberar ração</Text>
      <View style={estilos.linha}>
        <TextInput
          style={estilos.campo}
          keyboardType="numeric"
          value={qtd}
          onChangeText={setQtd}
        />
        <Text style={estilos.unidade}>g (completa o pote até)</Text>
      </View>
      <Pressable
        style={[estilos.botao, (emAndamento || enviando) && estilos.botaoOff]}
        onPress={pedirConfirmacao}
        disabled={emAndamento || enviando}
      >
        <Text style={estilos.botaoTexto}>
          {emAndamento || enviando ? "Aguarde..." : "Liberar ração"}
        </Text>
      </Pressable>
      {m ? <Text style={[estilos.resultado, { color: m.cor }]}>{m.texto}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  cartao: { margin: 12, padding: 14, borderRadius: 12, backgroundColor: "#fff3e0" },
  titulo: { fontSize: 16, fontWeight: "bold", marginBottom: 8 },
  linha: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  campo: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 8, width: 80, backgroundColor: "#fff" },
  unidade: { marginLeft: 8, color: "#555" },
  botao: { backgroundColor: "#e67e22", borderRadius: 8, padding: 14, alignItems: "center" },
  botaoOff: { backgroundColor: "#bdbdbd" },
  botaoTexto: { color: "#fff", fontWeight: "bold" },
  resultado: { marginTop: 10, fontWeight: "bold" },
});