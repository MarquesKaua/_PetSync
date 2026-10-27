import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

type Atual = {
  estimado_g: number;
  atualizado_em: Date;
  ultimo_abastecimento_em: Date | null;
};

type Abastecimento = {
  id: string;
  ts: Date;
  tipo: string;
  quantidade_g: number;
  estimado_antes_g: number;
  estimado_depois_g: number;
};

function formatar(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Estoque() {
  const [atual, setAtual] = useState<Atual | null>(null);
  const [lista, setLista] = useState<Abastecimento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const pararAtual = onSnapshot(
      doc(db, "estoque", "atual"),
      (snap) => {
        if (snap.exists()) {
          const x = snap.data();
          setAtual({
            estimado_g: x.estimado_g,
            atualizado_em: (x.atualizado_em as Timestamp).toDate(),
            ultimo_abastecimento_em: x.ultimo_abastecimento_em
              ? (x.ultimo_abastecimento_em as Timestamp).toDate()
              : null,
          });
        } else {
          setAtual(null);
        }
        setErro("");
        setCarregando(false);
      },
      () => {
        setErro("Não foi possível carregar o estoque.");
        setCarregando(false);
      }
    );

    const q = query(
      collection(db, "estoque", "atual", "abastecimentos"),
      orderBy("ts", "desc"),
      limit(10)
    );
    const pararLista = onSnapshot(
      q,
      (snap) => {
        setLista(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              ts: (x.ts as Timestamp).toDate(),
              tipo: x.tipo,
              quantidade_g: x.quantidade_g,
              estimado_antes_g: x.estimado_antes_g,
              estimado_depois_g: x.estimado_depois_g,
            };
          })
        );
      },
      () => setErro("Não foi possível carregar os abastecimentos.")
    );

    return () => {
      pararAtual();
      pararLista();
    };
  }, []);

  return (
    <div>
      <h2>Estoque de ração</h2>

      {erro && <p>{erro}</p>}
      {carregando && <p>Carregando...</p>}

      {!carregando && !erro && !atual && <p>Estoque ainda não registrado.</p>}

      {atual && (
        <>
          <p>
            Estimado no reservatório: ~{Math.round(atual.estimado_g)} g
          </p>
          <p>
            Atualizado em {formatar(atual.atualizado_em)}
            {atual.ultimo_abastecimento_em
              ? ` · último abastecimento em ${formatar(
                  atual.ultimo_abastecimento_em
                )}`
              : ""}
          </p>
          <p>
            É uma estimativa: o que foi abastecido menos o que foi liberado.
          </p>
        </>
      )}

      <h3>Abastecimentos</h3>
      {lista.length === 0 ? (
        <p>Nenhum abastecimento registrado.</p>
      ) : (
        <ul>
          {lista.map((a) => (
            <li key={a.id}>
              {formatar(a.ts)} ·{" "}
              {a.tipo === "adicionei"
                ? `Adicionou ${a.quantidade_g} g`
                : `Ajustou para ${a.quantidade_g} g`}{" "}
              (de {a.estimado_antes_g} g para {a.estimado_depois_g} g)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}