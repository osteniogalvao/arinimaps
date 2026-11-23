"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete, Fingerprint, Search } from "lucide-react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

type Pessoa = { user_id: string; nome: string; tem_pin: boolean; proxima: "entrada" | "saída" };

/**
 * Tela do terminal. Depois de marcar (ou de 30 s parada), volta sozinha ao
 * início: deixar a pessoa anterior selecionada é o caminho curto para o
 * próximo da fila marcar no nome de outro.
 */
export default function TerminalPonto({ pessoas }: { pessoas: Pessoa[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Pessoa | null>(null);
  const [pin, setPin] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const zerar = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? pessoas.filter((p) => p.nome.toLowerCase().includes(q)) : pessoas;
  }, [pessoas, busca]);

  function voltarAoInicio(depois = 0) {
    if (zerar.current) clearTimeout(zerar.current);
    zerar.current = setTimeout(() => { setSel(null); setPin(""); setBusca(""); setMsg(null); }, depois);
  }
  useEffect(() => {
    if (!sel) return;
    const t = setTimeout(() => { setSel(null); setPin(""); }, 30_000);
    return () => clearTimeout(t);
  }, [sel, pin]);
  useEffect(() => () => { if (zerar.current) clearTimeout(zerar.current); }, []);

  async function marcar() {
    if (!sel || pin.length < 4 || ocupado) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/ponto/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: sel.user_id, pin }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível marcar." }); setPin(""); return; }
      const c = j.comprovante;
      setMsg({ tipo: "ok", texto: `${sel.nome}: ${sel.proxima} marcada às ${new Date(c.marcado_em).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}. Comprovante NSR ${c.nsr}.` });
      setSel(null); setPin("");
      router.refresh();
      voltarAoInicio(8000);
    } catch {
      setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo ou marque pelo seu login." });
    } finally { setOcupado(false); }
  }

  const tecla = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));

  return (
    <div className="space-y-4">
      {msg && <p className={"cartao p-4 text-lg font-semibold " + (msg.tipo === "ok" ? "text-verde" : "text-critico")} role="status">{msg.texto}</p>}
      {!sel ? (
        <>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procure o seu nome" className={CAMPO_COMPACTO + " w-full pl-9 text-base"} />
          </label>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtradas.map((p) => (
              <li key={p.user_id}>
                <button type="button" onClick={() => { setSel(p); setPin(""); setMsg(null); }}
                  className="cartao cartao-link block w-full p-4 text-left">
                  <span className="block font-semibold text-texto">{p.nome}</span>
                  <span className="text-sm text-texto-2">{p.tem_pin ? `Próxima: ${p.proxima}` : "Ainda sem PIN"}</span>
                </button>
              </li>
            ))}
            {!filtradas.length && <li className="text-texto-2">Ninguém com esse nome.</li>}
          </ul>
        </>
      ) : (
        <div className="cartao mx-auto max-w-sm space-y-4 p-6 text-center">
          <p className="text-sm text-texto-2">Marcando {sel.proxima} de</p>
          <p className="lp-display text-2xl text-texto">{sel.nome}</p>
          {!sel.tem_pin ? (
            <p className="text-sm text-critico">Você ainda não criou o seu PIN. Entre no seu login, abra Meu ponto e crie um.</p>
          ) : (
            <>
              <p aria-live="polite" className="h-10 text-3xl tracking-[0.5em] text-texto">{"•".repeat(pin.length) || <span className="text-base tracking-normal text-texto-2">Digite o seu PIN</span>}</p>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button key={d} type="button" onClick={() => tecla(d)} className="btn-contorno py-4 text-xl">{d}</button>
                ))}
                <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Apagar" className="btn-contorno grid place-items-center py-4"><Delete className="size-5" /></button>
                <button type="button" onClick={() => tecla("0")} className="btn-contorno py-4 text-xl">0</button>
                <button type="button" onClick={marcar} disabled={pin.length < 4 || ocupado} aria-label="Marcar ponto"
                  className="btn-verde grid place-items-center py-4 disabled:opacity-50"><Fingerprint className="size-6" /></button>
              </div>
            </>
          )}
          <button type="button" onClick={() => { setSel(null); setPin(""); }} className="text-sm text-texto-2 underline">Não sou eu</button>
        </div>
      )}
    </div>
  );
}
