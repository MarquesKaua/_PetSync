import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function num(s: string) {
  return s.trim() === "" ? NaN : Number(s);
}

// Digita só números e o ":" entra sozinho (0800 vira 08:00)
function formatarHora(t: string) {
  const d = t.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + ":" + d.slice(2) : d;
}

export default function Configuracoes() {
  const [carregando, setCarregando] = useState(true);
  const [existe, setExiste] = useState(true);
  const [porcao, setPorcao] = useState("");
  const [limite, setLimite] = useState("");
  const [minimo, setMinimo] = useState("");
  const [alvo, setAlvo] = useState("");
  const [alerta, setAlerta] = useState("");
  const [horarios, setHorarios] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "config", "atual"))
      .then((snap) => {
        if (!snap.exists()) {
          setExiste(false);
        } else {
          const x = snap.data();
          setPorcao(String(x.porcao_g));
          setLimite(String(x.limite_diario_g));
          setMinimo(String(x.agua.nivel_minimo_pct));
          setAlvo(String(x.agua.nivel_alvo_pct));
          setAlerta(String(x.alerta_racao_baixa_g));
          setHorarios(x.horarios as string[]);
        }
        setCarregando(false);
      })
      .catch(() => {
        setErro("Não foi possível carregar a configuração.");
        setCarregando(false);
      });
  }, []);

  function mudarHorario(i: number, v: string) {
    setHorarios(horarios.map((h, idx) => (idx === i ? formatarHora(v) : h)));
  }

  async function salvar() {
    setMsg("");
    setErro("");

    const p = num(porcao);
    const l = num(limite);
    const min = num(minimo);
    const alv = num(alvo);
    const a = num(alerta);

    if (horarios.some((h) => !HORA.test(h)))
      return setErro("Horário inválido. Use o formato HH:MM, como 08:00.");
    const lista = Array.from(new Set(horarios)).sort();

    if (!(p > 0)) return setErro("A porção precisa ser maior que zero.");
    if (!(l >= p)) return setErro("O limite diário não pode ser menor que a porção.");
    if (!(min >= 0 && min < alv && alv <= 100))
      return setErro("Água: o mínimo precisa ser menor que o alvo, entre 0 e 100.");
    if (!(a >= 0)) return setErro("O aviso de ração baixa não pode ser negativo.");
    if (lista.length < 1 || lista.length > 6)
      return setErro("Use de 1 a 6 horários diferentes.");

    setSalvando(true);
    try {
      await updateDoc(doc(db, "config", "atual"), {
        porcao_g: p,
        limite_diario_g: l,
        horarios: lista,
        agua: { nivel_minimo_pct: min, nivel_alvo_pct: alv },
        alerta_racao_baixa_g: a,
        atualizado_em: serverTimestamp(),
      });
      setHorarios(lista);
      setMsg("Configuração salva. O dispositivo recebe em instantes.");
    } catch (e: any) {
      setErro(`Não foi possível salvar (${e?.code ?? "erro"}).`);
    }
    setSalvando(false);
  }

  if (carregando) return <Text style={estilos.aviso}>Carregando configuração...</Text>;
  if (!existe) return <Text style={estilos.aviso}>Configuração ainda não criada.</Text>;

  return (
    <ScrollView contentContainerStyle={estilos.tela} keyboardShouldPersistTaps="handled">
      <View style={estilos.cartao}>
        <Text style={estilos.titulo}>Ração</Text>
        <Text style={estilos.rotulo}>Porção por refeição (g)</Text>
        <TextInput style={estilos.campo} keyboardType="numeric" value={porcao} onChangeText={setPorcao} />
        <Text style={estilos.rotulo}>Limite diário (g)</Text>
        <TextInput style={estilos.campo} keyboardType="numeric" value={limite} onChangeText={setLimite} />
        <Text style={estilos.rotulo}>Avisar ração baixa no estoque abaixo de (g)</Text>
        <TextInput style={estilos.campo} keyboardType="numeric" value={alerta} onChangeText={setAlerta} />
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.titulo}>Horários das refeições</Text>
        {horarios.map((h, i) => (
          <View key={i} style={estilos.linha}>
            <TextInput
              style={[estilos.campo, { flex: 1, marginBottom: 0 }]}
              keyboardType="numeric"
              placeholder="08:00"
              maxLength={5}
              value={h}
              onChangeText={(v) => mudarHorario(i, v)}
            />
            <Pressable
              style={estilos.remover}
              onPress={() => setHorarios(horarios.filter((_, idx) => idx !== i))}
            >
              <Text style={estilos.removerTexto}>Remover</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={[estilos.botaoClaro, horarios.length >= 6 && estilos.off]}
          disabled={horarios.length >= 6}
          onPress={() => setHorarios([...horarios, ""])}
        >
          <Text style={estilos.botaoClaroTexto}>Adicionar horário</Text>
        </Pressable>
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.titulo}>Água</Text>
        <Text style={estilos.rotulo}>Começa a encher abaixo de (%)</Text>
        <TextInput style={estilos.campo} keyboardType="numeric" value={minimo} onChangeText={setMinimo} />
        <Text style={estilos.rotulo}>Para de encher em (%)</Text>
        <TextInput style={estilos.campo} keyboardType="numeric" value={alvo} onChangeText={setAlvo} />
      </View>

      <Pressable style={[estilos.botao, salvando && estilos.off]} onPress={salvar} disabled={salvando}>
        <Text style={estilos.botaoTexto}>{salvando ? "Salvando..." : "Salvar"}</Text>
      </Pressable>
      {msg ? <Text style={estilos.ok}>{msg}</Text> : null}
      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 16, paddingTop: 48 },
  aviso: { padding: 24, paddingTop: 64, textAlign: "center" },
  cartao: { backgroundColor: "#f5f5f5", borderRadius: 12, padding: 16, marginBottom: 12 },
  titulo: { fontSize: 16, fontWeight: "bold", marginBottom: 10 },
  rotulo: { fontSize: 13, color: "#555", marginBottom: 4 },
  campo: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff", marginBottom: 12 },
  linha: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  remover: { marginLeft: 8, padding: 10 },
  removerTexto: { color: "#c62828", fontWeight: "bold" },
  botao: { backgroundColor: "#1976d2", borderRadius: 8, padding: 14, alignItems: "center" },
  botaoTexto: { color: "#fff", fontWeight: "bold" },
  botaoClaro: { borderWidth: 1, borderColor: "#1976d2", borderRadius: 8, padding: 12, alignItems: "center" },
  botaoClaroTexto: { color: "#1976d2", fontWeight: "bold" },
  off: { opacity: 0.5 },
  ok: { marginTop: 12, color: "#2e7d32", fontWeight: "bold", textAlign: "center" },
  erro: { marginTop: 12, color: "#c62828", fontWeight: "bold", textAlign: "center" },
});