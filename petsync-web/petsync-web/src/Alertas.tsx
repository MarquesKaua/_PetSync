import { useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

type Alerta = {
  id: string;
  tipo: string;
  mensagem: string;
  criado_em: Date;
  ativo: boolean;
  resolvido_em: Date | null;
};

function formatar(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Alertas() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const q = query(
      collection(db, "alertas"),
      orderBy("criado_em", "desc"),
      limit(20)
    );
    const parar = onSnapshot(
      q,
      (snap) => {
        setAlertas(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              tipo: x.tipo,
              mensagem: x.mensagem,
              criado_em: (x.criado_em as Timestamp).toDate(),
              ativo: x.ativo,
              resolvido_em: x.resolvido_em
                ? (x.resolvido_em as Timestamp).toDate()
                : null,
            };
          })
        );
        setErro("");
        setCarregando(false);
      },
      () => {
        setErro("Não foi possível carregar os alertas.");
        setCarregando(false);
      }
    );
    return parar;
  }, []);

  const ativos = alertas.filter((a) => a.ativo);
  const resolvidos = alertas.filter((a) => !a.ativo);

  return (
    <div>
      <h2>Alertas</h2>

      {erro && <p>{erro}</p>}
      {carregando && <p>Carregando...</p>}

      {!carregando && !erro && (
        <>
          <h3>Ativos ({ativos.length})</h3>
          {ativos.length === 0 ? (
            <p>Nenhum alerta ativo. Tudo certo por aqui.</p>
          ) : (
            <ul>
              {ativos.map((a) => (
                <li key={a.id} style={{ color: "#c0392b", fontWeight: "bold" }}>
                  {formatar(a.criado_em)} · {a.mensagem}
                </li>
              ))}
            </ul>
          )}

          <h3>Resolvidos</h3>
          {resolvidos.length === 0 ? (
            <p>Nenhum alerta resolvido ainda.</p>
          ) : (
            <ul>
              {resolvidos.map((a) => (
                <li key={a.id}>
                  {formatar(a.criado_em)} · {a.mensagem}
                  {a.resolvido_em
                    ? ` (resolvido em ${formatar(a.resolvido_em)})`
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}