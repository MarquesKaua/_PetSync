import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ScrollView, StyleSheet } from "react-native";
import { addDoc, collection, doc, onSnapshot, serverTimestamp, Timestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

function hora(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Estoque() {
  const [estimado, setEstimado] = useState<number | null>(null);
  const [atualizado, setAtualizado] = useState<Date | null>(null);
  const [qtd, setQtd] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const parar = onSnapshot(doc(db, "estoque", "atual"), (snap) => {
      if (!snap.exists()) {
        setEstimado(null);
        return;
      }
      const x = snap.data();
      setEstimado(typeof x.estimado_g === "number" ? x.estimado_g : null);
      setAtualizado(x.atualizado_em ? (x.atualizado_em as Timestamp).toDate() : null);
    });
    return parar;
  }, []);

  function pedir(tipo: "adicionei" | "ajustei") {
    const n = Math.round(Number(qtd));
    if (!Number.isFinite(n) || n < 0 || (tipo === "adicionei" && n <= 0)) {
      Alert.alert("Quantidade inválida", "Digite um valor em gramas.");
      return;
    }
    const texto =
      tipo === "adicionei"
        ? `Somar ${n} g ao estoque estimado?`
        : `Definir o estoque estimado em ${n} g?`;
    Alert.alert("Confirmar", texto, [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar", onPress: () => enviar(tipo, n) },
    ]);
  }

  async function enviar(tipo: "adicionei" | "ajustei", n: number) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setEnviando(true);
    setMsg("");
    try {
      await addDoc(collection(db, "estoque", "atual", "abastecimentos"), {
        ts: serverTimestamp(),
        tipo,
        quantidade_g: n,
        por: uid,
      });
      setMsg("Pedido enviado. O estoque atualiza em instantes.");
      setQtd("");
    } catch (e: any) {
      Alert.alert("Erro", String(e?.code ?? e?.message ?? e));
    }
    setEnviando(false);
  }

  return (
    <ScrollView contentContainerStyle={estilos.tela} keyboardShouldPersistTaps="handled">
      <View style={estilos.cartao}>
        <Text style={estilos.rotulo}>Estoque estimado no reservatório</Text>
        {estimado === null ? (
          <Text style={estilos.pequeno}>Ainda não registrado.</Text>
        ) : (
          <>
            <Text style={estilos.numero}>~{Math.round(estimado)} g</Text>
            {atualizado ? <Text style={estilos.pequeno}>Atualizado em {hora(atualizado)}</Text> : null}
          </>
        )}
        <Text style={estilos.pequeno}>
          É uma estimativa: o que foi abastecido menos o que foi liberado.
        </Text>
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.rotulo}>Quantidade (g)</Text>
        <TextInput
          style={estilos.campo}
          keyboardType="numeric"
          placeholder="Ex.: 3000"
          value={qtd}
          onChangeText={setQtd}
        />
        <Pressable
          style={[estilos.botao, enviando && estilos.botaoOff]}
          onPress={() => pedir("adicionei")}
          disabled={enviando}
        >
          <Text style={estilos.botaoTexto}>Adicionei essa quantidade</Text>
        </Pressable>
        <Pressable
          style={[estilos.botaoClaro, enviando && estilos.botaoOff]}
          onPress={() => pedir("ajustei")}
          disabled={enviando}
        >
          <Text style={estilos.botaoClaroTexto}>Ajustar estoque para essa quantidade</Text>
        </Pressable>
        {msg ? <Text style={estilos.ok}>{msg}</Text> : null}
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 16, paddingTop: 48 },
  cartao: { backgroundColor: "#f5f5f5", borderRadius: 12, padding: 16, marginBottom: 12 },
  rotulo: { fontSize: 14, color: "#555", marginBottom: 6 },
  numero: { fontSize: 36, fontWeight: "bold" },
  pequeno: { fontSize: 12, color: "#777", marginTop: 4 },
  campo: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff", marginBottom: 12 },
  botao: { backgroundColor: "#2e7d32", borderRadius: 8, padding: 14, alignItems: "center", marginBottom: 8 },
  botaoTexto: { color: "#fff", fontWeight: "bold" },
  botaoClaro: { borderWidth: 1, borderColor: "#1976d2", borderRadius: 8, padding: 14, alignItems: "center" },
  botaoClaroTexto: { color: "#1976d2", fontWeight: "bold" },
  botaoOff: { opacity: 0.5 },
  ok: { marginTop: 10, color: "#2e7d32", fontWeight: "bold" },
});