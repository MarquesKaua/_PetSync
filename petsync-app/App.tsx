import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import Login from "./Login";
import Status from "./Status";
import LiberarRacao from "./LiberarRacao";
import Estoque from "./Estoque";
import Configuracoes from "./Configuracoes";

type Aba = "inicio" | "estoque" | "config";

export default function App() {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("inicio");

  useEffect(() => {
    const parar = onAuthStateChanged(auth, (u) => {
      setUsuario(u);
      setCarregando(false);
    });
    return parar;
  }, []);

  if (carregando) {
    return (
      <View style={estilos.centro}>
        <Text>Carregando...</Text>
      </View>
    );
  }
  if (!usuario) return <Login />;

  function BotaoAba({ id, rotulo }: { id: Aba; rotulo: string }) {
    return (
      <Pressable style={estilos.aba} onPress={() => setAba(id)}>
        <Text style={[estilos.abaTexto, aba === id && estilos.abaAtiva]}>{rotulo}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flex: 1 }}>
        {aba === "inicio" && (
          <>
            <Status />
            <LiberarRacao />
          </>
        )}
        {aba === "estoque" && <Estoque />}
        {aba === "config" && <Configuracoes />}
      </View>

      <View style={estilos.abas}>
        <BotaoAba id="inicio" rotulo="Início" />
        <BotaoAba id="estoque" rotulo="Estoque" />
        <BotaoAba id="config" rotulo="Config" />
      </View>

      <View style={estilos.rodape}>
        <Text style={estilos.pequeno}>{usuario.email}</Text>
        <Pressable style={estilos.botao} onPress={() => signOut(auth)}>
          <Text style={estilos.botaoTexto}>Sair</Text>
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  abas: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#eee" },
  aba: { flex: 1, padding: 14, alignItems: "center" },
  abaTexto: { color: "#777", fontWeight: "bold" },
  abaAtiva: { color: "#1976d2" },
  botao: { backgroundColor: "#1976d2", borderRadius: 8, padding: 10 },
  botaoTexto: { color: "#fff", fontWeight: "bold" },
  rodape: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  pequeno: { fontSize: 12, color: "#777" },
});