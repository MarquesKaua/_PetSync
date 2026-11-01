import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function entrar() {
    setErro("");
    setEntrando(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), senha);
    } catch {
      setErro("E-mail ou senha incorretos.");
    }
    setEntrando(false);
  }

  return (
    <View style={estilos.tela}>
      <Text style={estilos.titulo}>PetSync</Text>
      <TextInput
        style={estilos.campo}
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={estilos.campo}
        placeholder="Senha"
        secureTextEntry
        value={senha}
        onChangeText={setSenha}
      />
      <Pressable style={estilos.botao} onPress={entrar} disabled={entrando}>
        <Text style={estilos.botaoTexto}>{entrando ? "Entrando..." : "Entrar"}</Text>
      </Pressable>
      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  titulo: { fontSize: 32, fontWeight: "bold", textAlign: "center", marginBottom: 24 },
  campo: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, marginBottom: 12 },
  botao: { backgroundColor: "#1976d2", borderRadius: 8, padding: 14, alignItems: "center" },
  botaoTexto: { color: "#fff", fontWeight: "bold" },
  erro: { color: "#c0392b", textAlign: "center", marginTop: 12 },
});