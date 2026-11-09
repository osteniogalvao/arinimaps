"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { SETORES } from "@/lib/setores";
import { SENHA_MIN } from "@/lib/seguranca/senha";
import { CAMPO, Etiqueta, ROTULO } from "@/components/ui/Pagina";
import { Plus, UserCheck, UserX, X } from "lucide-react";

type Membro = { user_id: string; nome: string; role: string; ativo: boolean; email: string; setores: string[] };

// a diretoria entra em todos os setores; para os demais, escolhe-se aqui
const ESCOLHIVEIS = SETORES.filter((s) => s.id !== "diretoria");

export default function GestaoUsuarios({
  equipe, souEu, ehDiretoria,
}: { equipe: Membro[]; souEu: string; ehDiretoria: boolean }) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ nome: "", email: "", senha: "", role: "analista_arini", setores: ["operacoes"] as string[] });

  const input = CAMPO;

  async function chamar(method: "POST" | "PATCH", body: unknown) {
    setOcupado(true); setErro(""); setMsg("");
    const r = await enviarJson("/api/admin/usuarios", method, body);
    setOcupado(false);
    if (!r.ok) { setErro([r.erro.mensagem, r.erro.motivo].filter(Boolean).join(" — ")); return false; }
    router.refresh();
    return true;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="lp-eyebrow text-xs">Equipe</p>
          <h2 className="lp-display mt-2 text-2xl md:text-[1.75rem] text-texto">Equipe Arini ({equipe.length})</h2>
        </div>
        {ehDiretoria && (
          <button onClick={() => setCriando(!criando)}
            className={(criando ? "btn-contorno" : "btn-verde") + " inline-flex items-center gap-2 px-5 py-3 text-sm"}>
            {criando ? <X className="size-4" /> : <Plus className="size-4" />}
            {criando ? "Cancelar" : "Novo acesso"}
          </button>
        )}
      </div>

      {criando && (
        <div className="cartao p-6 space-y-5">
          <p className="lp-display text-lg text-texto">Novo acesso da equipe</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={ROTULO}>Nome completo</span>
              <input className={input} placeholder="Nome completo"
                value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </label>
            <label className="block">
              <span className={ROTULO}>E-mail de acesso</span>
              <input className={input} type="email" placeholder="E-mail de acesso"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="block">
              <span className={ROTULO}>Senha provisória</span>
              <input className={input} type="password" placeholder={`Mínimo ${SENHA_MIN} caracteres, letras e números`}
                value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
            </label>
            <label className="block">
              <span className={ROTULO}>Papel</span>
              <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="analista_arini">Equipe — entra só nos setores marcados abaixo</option>
                <option value="admin_central">Diretoria — entra em todos os setores</option>
              </select>
            </label>
          </div>
          {form.role === "analista_arini" && (
            <div>
            <p className={ROTULO}>Setores</p>
            <div className="flex flex-wrap gap-2">
              {ESCOLHIVEIS.map((s) => {
                const marcado = form.setores.includes(s.id);
                return (
                  <label key={s.id}
                    className={"rounded-lg border px-3 py-1.5 text-sm font-semibold cursor-pointer transition-colors " +
                      (marcado ? "border-verde bg-verde/10 text-verde" : "border-linha-forte text-texto-2 hover:text-texto")}>
                    <input type="checkbox" className="hidden" checked={marcado}
                      onChange={() => setForm({ ...form, setores: marcado ? form.setores.filter((x) => x !== s.id) : [...form.setores, s.id] })} />
                    {s.nome}
                  </label>
                );
              })}
            </div>
            </div>
          )}
          <button disabled={ocupado} className="btn-ouro px-6 py-3 disabled:opacity-50"
            onClick={async () => {
              if (await chamar("POST", form)) {
                setMsg(`Acesso criado para ${form.email}.`);
                setForm({ nome: "", email: "", senha: "", role: "analista_arini", setores: ["operacoes"] });
                setCriando(false);
              }
            }}>
            Criar acesso
          </button>
        </div>
      )}

      {erro && <p className="rounded-xl border border-critico/40 bg-critico/10 px-4 py-3 text-sm font-semibold text-critico">{erro}</p>}
      {msg && <p className="rounded-xl border border-verde/30 bg-verde/10 px-4 py-3 text-sm font-semibold text-verde">{msg}</p>}

      <div className="cartao overflow-hidden divide-y divide-linha">
        {equipe.map((m) => (
          <div key={m.user_id} className="px-5 py-4 flex items-center gap-4 flex-wrap text-[0.95rem] transition-colors hover:bg-superficie-2/50">
            <div className="flex-1 min-w-44">
              <p className="font-semibold text-texto">
                {m.nome || "—"}
                {m.user_id === souEu && <span className="ml-2 text-sm font-normal text-texto-2">(você)</span>}
              </p>
              <p className="text-sm text-texto-2">{m.email}</p>
              {m.role === "admin_central" ? (
                <p className="text-sm text-texto-2 mt-2">Todos os setores</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {ESCOLHIVEIS.map((s) => {
                    const marcado = m.setores.includes(s.id);
                    return ehDiretoria ? (
                      <button key={s.id} type="button" disabled={ocupado}
                        onClick={() => chamar("PATCH", {
                          user_id: m.user_id,
                          setores: marcado ? m.setores.filter((x) => x !== s.id) : [...m.setores, s.id],
                        })}
                        className={"rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors " +
                          (marcado ? "border-verde/40 bg-verde/10 text-verde" : "border-linha text-texto-2 hover:text-texto hover:border-linha-forte")}>
                        {s.nome}
                      </button>
                    ) : marcado ? (
                      <Etiqueta key={s.id} tom="verde">{s.nome}</Etiqueta>
                    ) : null;
                  })}
                  {!m.setores.length && !ehDiretoria && <Etiqueta tom="alerta">sem setor</Etiqueta>}
                </div>
              )}
            </div>
            {ehDiretoria && m.user_id !== souEu ? (
              <select value={m.role} disabled={ocupado}
                onChange={(e) => chamar("PATCH", { user_id: m.user_id, role: e.target.value })}
                className="rounded-lg border border-linha-forte bg-superficie-2 px-3 py-2 text-sm text-texto">
                <option value="analista_arini">Equipe</option>
                <option value="admin_central">Diretoria</option>
              </select>
            ) : (
              <Etiqueta tom={m.role === "admin_central" ? "ouro" : "neutro"}>
                {m.role === "admin_central" ? "Diretoria" : "Equipe"}
              </Etiqueta>
            )}
            <Etiqueta tom={m.ativo ? "verde" : "critico"}>
              {m.ativo ? "ativo" : "desativado"}
            </Etiqueta>
            {ehDiretoria && m.user_id !== souEu && (
              <button disabled={ocupado}
                onClick={() => chamar("PATCH", { user_id: m.user_id, ativo: !m.ativo })}
                className={(m.ativo ? "btn-perigo" : "btn-contorno") + " inline-flex items-center gap-1.5 px-3.5 py-2 text-sm"}>
                {m.ativo ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                {m.ativo ? "Desativar" : "Reativar"}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
