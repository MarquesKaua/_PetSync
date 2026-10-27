import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "./firebase";

type Ponto = { hora: string; agua: number | null; racao: number | null };

type Alimentacao = {
  id: string;
  ts: Date;
  origem: string;
  meta_g: number;
  liberado_g: number;
  status: string;
  motivo: string | null;
};

const PERIODOS = [
  { rotulo: "24 h", horas: 24 },
  { rotulo: "3 dias", horas: 72 },
  { rotulo: "7 dias", horas: 168 },
];

function formatar(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Historico() {
  const [horas, setHoras] = useState(72);
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [alimentacoes, setAlimentacoes] = useState<Alimentacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Gráfico: recarrega quando o período muda
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro("");

    const desde = Timestamp.fromMillis(Date.now() - horas * 60 * 60 * 1000);
    const q = query(
      collection(db, "leituras"),
      where("ts", ">=", desde),
      orderBy("ts", "asc")
    );

    getDocs(q)
      .then((snap) => {
        if (cancelado) return;
        const lista: Ponto[] = snap.docs.map((d) => {
          const x = d.data();
          return {
            hora: formatar((x.ts as Timestamp).toDate()),
            agua: x.agua_valida ? x.agua_pct : null,
            racao: x.racao_valida ? Math.min(x.racao_pct, 100) : null,
          };
        });
        setPontos(lista);
        setCarregando(false);
      })
      .catch(() => {
        if (cancelado) return;
        setErro("Não foi possível carregar as leituras (permissão ou conexão).");
        setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [horas]);

  // Lista de alimentações: carrega uma vez
  useEffect(() => {
    const q = query(
      collection(db, "alimentacoes"),
      orderBy("ts", "desc"),
      limit(10)
    );
    getDocs(q)
      .then((snap) => {
        setAlimentacoes(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              ts: (x.ts as Timestamp).toDate(),
              origem: x.origem,
              meta_g: x.meta_g,
              liberado_g: x.liberado_g,
              status: x.status,
              motivo: x.motivo ?? null,
            };
          })
        );
      })
      .catch(() => setErro("Não foi possível carregar as alimentações."));
  }, []);

  return (
    <div>
      <h2>Histórico</h2>

      <div>
        {PERIODOS.map((p) => (
          <button
            key={p.horas}
            onClick={() => setHoras(p.horas)}
            disabled={horas === p.horas}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {erro && <p>{erro}</p>}
      {carregando && <p>Carregando...</p>}
      {!carregando && !erro && pontos.length === 0 && (
        <p>Sem leituras nesse período.</p>
      )}

      {pontos.length > 0 && (
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={pontos}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hora" minTickGap={40} />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="agua"
                name="Água"
                stroke="#1976d2"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="racao"
                name="Ração no pote"
                stroke="#e67e22"
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <h2>Últimas alimentações</h2>
      {alimentacoes.length === 0 ? (
        <p>Nenhuma alimentação registrada.</p>
      ) : (
        <ul>
          {alimentacoes.map((a) => (
            <li key={a.id}>
              {formatar(a.ts)} · {a.origem} · meta {a.meta_g} g · liberado{" "}
              {a.liberado_g} g · {a.status}
              {a.motivo ? ` (${a.motivo})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}