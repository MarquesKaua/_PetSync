import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import Login from "./Login";
import Painel from "./Painel";
import Historico from "./Historico";

export default function App() {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const parar = onAuthStateChanged(auth, (u) => {
      setUsuario(u);
      setCarregando(false);
    });
    return parar;
  }, []);

  if (carregando) return <p>Carregando...</p>;
  if (!usuario) return <Login />;

   return (
    <div>
      <h1>PetSync</h1>
      <p>Logado como {usuario.email}</p>
      <button onClick={() => signOut(auth)}>Sair</button>
      <Painel />
      <Historico />
    </div>
  );
}