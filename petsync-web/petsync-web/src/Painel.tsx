import { useEffect, useState } from "react";
import { doc, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

type Leitura = {
  nivel_pct: number | null;
  valido: boolean;
  atualizado_em: Timestamp;
};

type Estado = {
  agua: Leitura;
  racao: Leitura & { peso_g: number | null };
  dispositivo: { online: boolean; visto_em: Timestamp };
};

export default function Painel() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const parar = onSnapshot(
      doc(db, "estado", "atual"),
      (snap) => {
        setEstado(snap.exists() ? (snap.data() as Estado) : null);
        setErro("");
      },
      () => setErro("Sem permissão ou sem conexão com o banco.")
    );
    return parar;
  }, []);

  if (erro) return <p>{erro}</p>;
  if (!estado) return <p>Aguardando dados do dispositivo...</p>;

  const { agua, racao, dispositivo } = estado;

  return (
    <div>
      <h2>Situação agora</h2>
      <p>
        Dispositivo: {dispositivo.online ? "online" : "offline"} (visto às{" "}
        {dispositivo.visto_em.toDate().toLocaleTimeString("pt-BR")})
      </p>
      <p>
        Água:{" "}
        {agua.valido && agua.nivel_pct !== null
          ? `${agua.nivel_pct}%`
          : "leitura inválida"}
      </p>
      <p>
        Ração no pote:{" "}
        {racao.valido && racao.peso_g !== null
          ? `${racao.peso_g} g (${racao.nivel_pct}% da porção)`
          : "leitura inválida"}
      </p>
    </div>
  );
}