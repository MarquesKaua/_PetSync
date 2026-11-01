import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { collection, doc, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

type Leitura = { nivel_pct: number | null; valido: boolean };
type Estado = {
  agua?: Leitura;
  racao?: Leitura & { peso_g: number | null };
  dispositivo?: { online: boolean; visto_em?: Timestamp };
};
type Alerta = { id: string; mensagem: string; criado_em: Date };

function hora(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Barra({ pct, cor }: { pct: number; cor: string }) {
  const largura = Math.max(0, Math.min(100, pct));
  return (
    <View style={estilos.barraFundo}>
      <View style={[estilos.barraCheia, { width: `${largura}%`, backgroundColor: cor }]} />
    </View>
  );
}

export default function Status() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const pararEstado = onSnapshot(
      doc(db, "estado", "atual"),
      (snap) => {
        setEstado(snap.exists() ? (snap.data() as Estado) : null);
        setErro("");
      },
      () => setErro("Sem permissão ou sem conexão com o banco.")
    );

    const pararAlertas = onSnapshot(
      query(collection(db, "alertas"), where("ativo", "==", true)),
      (snap) => {
        const lista = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            mensagem: x.mensagem as string,
            criado_em: (x.criado_em as Timestamp).toDate(),
          };
        });
        lista.sort((a, b) => b.criado_em.getTime() - a.criado_em.getTime());
        setAlertas(lista);
      },
      () => setErro("Não foi possível carregar os alertas.")
    );

    return () => {
      pararEstado();
      pararAlertas();
    };
  }, []);

  if (erro) return <Text style={estilos.aviso}>{erro}</Text>;
  if (!estado) return <Text style={estilos.aviso}>Aguardando dados do dispositivo...</Text>;

  const online = estado.dispositivo?.online ?? false;
  const visto = estado.dispositivo?.visto_em?.toDate();
  const agua = estado.agua;
  const racao = estado.racao;

  return (
    <ScrollView contentContainerStyle={estilos.tela}>
      <View style={[estilos.faixa, { backgroundColor: online ? "#e8f5e9" : "#ffebee" }]}>
        <Text style={{ fontWeight: "bold", color: online ? "#2e7d32" : "#c62828" }}>
          {online ? "Dispositivo online" : "Dispositivo offline"}
        </Text>
        {visto ? <Text style={estilos.pequeno}>Visto em {hora(visto)}</Text> : null}
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.rotulo}>Água</Text>
        {agua && agua.valido && agua.nivel_pct !== null ? (
          <>
            <Text style={estilos.numero}>{agua.nivel_pct}%</Text>
            <Barra pct={agua.nivel_pct} cor="#1976d2" />
          </>
        ) : (
          <Text style={estilos.invalido}>Leitura inválida</Text>
        )}
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.rotulo}>Ração no pote</Text>
        {racao && racao.valido && racao.peso_g !== null && racao.nivel_pct !== null ? (
          <>
            <Text style={estilos.numero}>{racao.peso_g} g</Text>
            <Text style={estilos.pequeno}>{racao.nivel_pct}% da porção</Text>
            <Barra pct={racao.nivel_pct} cor="#e67e22" />
          </>
        ) : (
          <Text style={estilos.invalido}>Leitura inválida</Text>
        )}
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.rotulo}>Alertas ativos ({alertas.length})</Text>
        {alertas.length === 0 ? (
          <Text style={estilos.pequeno}>Nenhum alerta. Tudo certo por aqui.</Text>
        ) : (
          alertas.map((a) => (
            <View key={a.id} style={estilos.alerta}>
              <Text style={estilos.alertaTexto}>{a.mensagem}</Text>
              <Text style={estilos.pequeno}>{hora(a.criado_em)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 16, paddingTop: 48 },
  aviso: { padding: 24, paddingTop: 64, textAlign: "center" },
  faixa: { padding: 12, borderRadius: 10, marginBottom: 12 },
  cartao: { backgroundColor: "#f5f5f5", borderRadius: 12, padding: 16, marginBottom: 12 },
  rotulo: { fontSize: 14, color: "#555", marginBottom: 6 },
  numero: { fontSize: 36, fontWeight: "bold" },
  pequeno: { fontSize: 12, color: "#777" },
  invalido: { fontSize: 16, color: "#c62828" },
  barraFundo: { height: 10, backgroundColor: "#ddd", borderRadius: 5, marginTop: 8, overflow: "hidden" },
  barraCheia: { height: 10, borderRadius: 5 },
  alerta: { marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: "#ffebee" },
  alertaTexto: { color: "#c62828", fontWeight: "bold" },
});