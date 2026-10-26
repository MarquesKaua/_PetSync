import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      await signInWithEmailAndPassword(auth, email, senha);
    } catch {
      setErro("E-mail ou senha incorretos.");
    }
    setEntrando(false);
  }

  return (
    <form onSubmit={entrar}>
      <h1>PetSync</h1>
      <input
        type="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Senha"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
      />
      <button type="submit" disabled={entrando}>
        {entrando ? "Entrando..." : "Entrar"}
      </button>
      {erro && <p>{erro}</p>}
    </form>
  );
}