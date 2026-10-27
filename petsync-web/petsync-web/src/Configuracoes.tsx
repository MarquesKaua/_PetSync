import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

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

  function mudarHorario(i: number, valor: string) {
    setHorarios(horarios.map((h, idx) => (idx === i ? valor : h)));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErro("");

    const p = Number(porcao);
    const l = Number(limite);
    const min = Number(minimo);
    const alv = Number(alvo);
    const a = Number(alerta);
    const lista = Array.from(new Set(horarios.filter((h) => h))).sort();

    if (!(p > 0)) return setErro("A porção precisa ser maior que zero.");
    if (!(l >= p)) return setErro("O limite diário não pode ser menor que a porção.");
    if (!(min >= 0 && min < alv && alv <= 100))
      return setErro("Água: o mínimo precisa ser menor que o alvo, entre 0 e 100.");
    if (!(a >= 0)) return setErro("O alerta de ração baixa não pode ser negativo.");
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
      setMsg("Configuração salva.");
    } catch {
      setErro("Não foi possível salvar (permissão ou conexão).");
    }
    setSalvando(false);
  }

  if (carregando) return <p>Carregando configuração...</p>;
  if (!existe) return <p>Configuração ainda não criada.</p>;

  return (
    <form onSubmit={salvar}>
      <h2>Configurações</h2>

      <p>
        <label>
          Porção por refeição (g){" "}
          <input type="number" value={porcao} onChange={(e) => setPorcao(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Limite diário (g){" "}
          <input type="number" value={limite} onChange={(e) => setLimite(e.target.value)} />
        </label>
      </p>

      <p>Horários das refeições:</p>
      {horarios.map((h, i) => (
        <p key={i}>
          <input type="time" value={h} onChange={(e) => mudarHorario(i, e.target.value)} />{" "}
          <button
            type="button"
            onClick={() => setHorarios(horarios.filter((_, idx) => idx !== i))}
          >
            Remover
          </button>
        </p>
      ))}
      <button
        type="button"
        disabled={horarios.length >= 6}
        onClick={() => setHorarios([...horarios, "12:00"])}
      >
        Adicionar horário
      </button>

      <p>
        <label>
          Água: começa a encher abaixo de (%){" "}
          <input type="number" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Água: para de encher em (%){" "}
          <input type="number" value={alvo} onChange={(e) => setAlvo(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Avisar ração baixa no estoque abaixo de (g){" "}
          <input type="number" value={alerta} onChange={(e) => setAlerta(e.target.value)} />
        </label>
      </p>

      <button type="submit" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
      {msg && <p>{msg}</p>}
      {erro && <p>{erro}</p>}
    </form>
  );
}