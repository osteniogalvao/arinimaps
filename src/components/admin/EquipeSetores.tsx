"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Crown, Link2, Plus, UserMinus, X } from "lucide-react";
import { enviarJson } from "@/lib/api/enviar";
import { SETORES } from "@/lib/setores";
import { SENHA_MIN } from "@/lib/seguranca/senha";
import { CARGO_MAX, CARGOS_SUGERIDOS } from "@/lib/equipe";
import { CAMPO, Etiqueta, ROTULO } from "@/components/ui/Pagina";
import CampoSenha from "@/components/ui/CampoSenha";

export type Pessoa = {
  user_id: string; nome: string; email: string; diretoria: boolean; ativo: boolean;
  setores: string[]; gestor: string[]; cargo: string | null; recepcao: boolean;
  acesso: "operador" | "leitura";
};

const SETORES_EQUIPE = SETORES.filter((s) => s.id !== "diretoria");

/** Função da pessoa, editável por quem organiza o setor. */
function Funcao({ p, pode, salvar }: { p: Pessoa; pode: boolean; salvar: (cargo: string) => Promise<boolean> }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(p.cargo ?? "");
  if (!pode) return p.cargo ? <span className="text-sm text-texto-2">{p.cargo}</span> : null;
  if (!editando) {
    return (
      <button type="button" onClick={() => { setValor(p.cargo ?? ""); setEditando(true); }}
        className="text-sm text-texto-2 underline decoration-dotted underline-offset-4 hover:text-texto">
        {p.cargo || "definir função"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input autoFocus list="funcoes-sugeridas" maxLength={CARGO_MAX} value={valor} onChange={(e) => setValor(e.target.value)}
        onKeyDown={async (e) => { if (e.key === "Enter" && await salvar(valor)) setEditando(false); if (e.key === "Escape") setEditando(false); }}
        className="w-44 rounded-lg border border-linha-forte bg-superficie-2 px-2.5 py-1 text-sm text-texto" placeholder="Ex.: Corretor" />
      <button type="button" className="btn-verde px-2.5 py-1 text-xs" onClick={async () => { if (await salvar(valor)) setEditando(false); }}>Salvar</button>
      <button type="button" aria-label="Cancelar" className="text-texto-2" onClick={() => setEditando(false)}><X className="size-4" /></button>
    </span>
  );
}

/**
 * Link de primeiro acesso, para mandar à pessoa (WhatsApp ou e-mail). Mostrado
 * uma vez, logo depois do convite ou de "Gerar link".
 */
function LinkGerado({ link, nome, aoFechar }: { link: string; nome: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Olá, ${nome}! Este é o seu acesso à Central ARINI. Abra o link, crie a sua senha e entre com o seu e-mail (vale por 1 hora): ${link}`;
  return (
    <div className="cartao border-verde/40 p-5 space-y-3" role="status">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-texto">Link de acesso de {nome}</p>
        <button type="button" aria-label="Fechar" onClick={aoFechar} className="text-texto-2 hover:text-texto"><X className="size-4" /></button>
      </div>
      <p className="text-sm text-texto-2">Mande para a pessoa. Ela abre, cria a própria senha e entra só nos setores dela. Vale por 1 hora e só funciona uma vez; se vencer, gere outro.</p>
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de acesso"
        className="w-full rounded-lg border border-linha-forte bg-superficie-2 px-3 py-2 font-mono text-xs text-texto" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-verde inline-flex items-center gap-2 px-4 py-2 text-sm"
          onClick={async () => { await navigator.clipboard?.writeText(link).catch(() => undefined); setCopiado(true); }}>
          <Copy className="size-4" /> {copiado ? "Copiado" : "Copiar link"}
        </button>
        <a className="btn-contorno inline-flex items-center gap-2 px-4 py-2 text-sm" target="_blank" rel="noreferrer"
          href={`https://wa.me/?text=${encodeURIComponent(texto)}`}>Enviar pelo WhatsApp</a>
      </div>
    </div>
  );
}

export default function EquipeSetores({ pessoas, souEu, diretoria, gere, semMigration, setorUnico }: {
  pessoas: Pessoa[]; souEu: string; diretoria: boolean; gere: string[]; semMigration: boolean;
  /** equipe de um setor só (dentro do bloco do setor) */
  setorUnico?: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [criando, setCriando] = useState(false);
  const vazio = { nome: "", email: "", senha: "", cargo: "",
    setores: setorUnico && gere.includes(setorUnico) ? [setorUnico] : gere.length === 1 ? [gere[0]] : [] as string[] };
  // convite: por link (a pessoa cria a senha) ou com senha provisória
  const [modo, setModo] = useState<"link" | "senha">("link");
  const [linkGerado, setLinkGerado] = useState<{ link: string; nome: string } | null>(null);
  const [form, setForm] = useState(vazio);
  const [adicionar, setAdicionar] = useState<Record<string, string>>({});

  const equipe = useMemo(() => pessoas.filter((p) => !p.diretoria), [pessoas]);
  const direcao = useMemo(() => pessoas.filter((p) => p.diretoria && p.ativo), [pessoas]);
  const semSetor = equipe.filter((p) => p.ativo && !p.setores.length);
  const organiza = diretoria || gere.length > 0;

  async function chamar(body: Record<string, unknown>, ok?: string, nomeLink?: string) {
    setOcupado(true); setErro(""); setMsg("");
    const r = await enviarJson<{ link?: string }>("/api/admin/equipe", "POST", body);
    setOcupado(false);
    if (!r.ok) { setErro([r.erro.mensagem, r.erro.motivo].filter(Boolean).join(" — ")); return false; }
    if (ok) setMsg(ok);
    if (r.dados?.link) setLinkGerado({ link: r.dados.link, nome: nomeLink ?? "a pessoa" });
    router.refresh();
    return true;
  }
  // num setor só, a tela mostra apenas ele (e quem ainda não tem setor)
  const setoresVisiveis = setorUnico ? SETORES_EQUIPE.filter((s) => s.id === setorUnico) : SETORES_EQUIPE;

  const podeFuncao = (p: Pessoa) => !semMigration && (diretoria || (!p.diretoria && p.setores.some((s) => gere.includes(s))));

  return (
    <div className="space-y-8">
      <datalist id="funcoes-sugeridas">{CARGOS_SUGERIDOS.map((c) => <option key={c} value={c} />)}</datalist>

      {(setorUnico ? gere.includes(setorUnico) : organiza) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-texto-2">
            {diretoria ? "Você organiza todos os setores." : <>Você é gestor de: <strong className="text-texto">{gere.map((s) => SETORES.find((x) => x.id === s)?.nome).join(", ")}</strong>.</>}
          </p>
          <button onClick={() => { setCriando(!criando); setForm(vazio); }}
            className={(criando ? "btn-contorno" : "btn-verde") + " inline-flex items-center gap-2 px-5 py-3 text-sm"}>
            {criando ? <X className="size-4" /> : <Plus className="size-4" />}
            {criando ? "Cancelar" : setorUnico ? "Adicionar pessoa" : "Novo acesso"}
          </button>
        </div>
      )}

      {criando && (
        <div className="cartao p-6 space-y-5">
          <p className="lp-display text-lg text-texto">{setorUnico ? "Adicionar pessoa ao setor" : "Novo acesso da equipe"}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Como a pessoa vai entrar">
            {([["link", "Por link (a pessoa cria a senha)"], ["senha", "Com senha provisória"]] as const).map(([v, r]) => (
              <button key={v} type="button" role="radio" aria-checked={modo === v} onClick={() => setModo(v)}
                className={"rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors " +
                  (modo === v ? "border-verde bg-verde/10 text-verde" : "border-linha-forte text-texto-2 hover:text-texto")}>
                {r}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className={ROTULO}>Nome completo</span>
              <input className={CAMPO} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
            <label className="block"><span className={ROTULO}>E-mail de acesso</span>
              <input className={CAMPO} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            {modo === "senha" && (
              <label className="block"><span className={ROTULO}>Senha provisória</span>
                <CampoSenha className={CAMPO} autoComplete="new-password" placeholder={`Mínimo ${SENHA_MIN} caracteres, letras e números`}
                  value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></label>
            )}
            {!semMigration && (
              <label className="block"><span className={ROTULO}>Função</span>
                <input className={CAMPO} list="funcoes-sugeridas" maxLength={CARGO_MAX} placeholder="Ex.: Corretor, Recepcionista"
                  value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} /></label>
            )}
          </div>
          {!setorUnico && <div>
            <p className={ROTULO}>Setores que a pessoa acessa</p>
            <div className="flex flex-wrap gap-2">
              {SETORES_EQUIPE.filter((s) => gere.includes(s.id)).map((s) => {
                const marcado = form.setores.includes(s.id);
                return (
                  <label key={s.id} className={"rounded-lg border px-3 py-1.5 text-sm font-semibold cursor-pointer transition-colors " +
                    (marcado ? "border-verde bg-verde/10 text-verde" : "border-linha-forte text-texto-2 hover:text-texto")}>
                    <input type="checkbox" className="hidden" checked={marcado}
                      onChange={() => setForm({ ...form, setores: marcado ? form.setores.filter((x) => x !== s.id) : [...form.setores, s.id] })} />
                    {s.nome}
                  </label>
                );
              })}
            </div>
          </div>}
          {modo === "link" && <p className="text-sm text-texto-2">A pessoa recebe um link por e-mail para criar a própria senha. O link também aparece aqui, para mandar pelo WhatsApp.</p>}
          <button disabled={ocupado} className="btn-ouro px-6 py-3 disabled:opacity-50"
            onClick={async () => {
              const ok = modo === "link"
                ? await chamar({ acao: "convidar", ...form, senha: undefined }, `${form.nome || "Pessoa"} foi adicionada. Mande o link abaixo.`, form.nome)
                : await chamar({ acao: "criar", ...form }, `Acesso criado para ${form.email}. Passe a senha provisória à pessoa.`);
              if (ok) { setCriando(false); setForm(vazio); }
            }}>
            {modo === "link" ? "Adicionar e gerar link" : "Criar acesso"}
          </button>
        </div>
      )}

      {erro && <p role="alert" className="rounded-xl border border-critico/40 bg-critico/10 px-4 py-3 text-sm font-semibold text-critico">{erro}</p>}
      {msg && <p className="rounded-xl border border-verde/30 bg-verde/10 px-4 py-3 text-sm font-semibold text-verde">{msg}</p>}
      {linkGerado && <LinkGerado link={linkGerado.link} nome={linkGerado.nome} aoFechar={() => setLinkGerado(null)} />}

      {organiza && !setorUnico && semSetor.length > 0 && (
        <div className="cartao border-alerta/40 p-5">
          <p className="font-semibold text-texto">Sem setor ({semSetor.length})</p>
          <p className="mt-1 text-sm text-texto-2">Essas pessoas entram na Central mas não enxergam nenhum setor. Libere um setor abaixo.</p>
          <p className="mt-2 text-sm text-texto">{semSetor.map((p) => p.nome).join(", ")}</p>
        </div>
      )}

      <div className={setorUnico ? "grid gap-5" : "grid gap-5 lg:grid-cols-2"}>
        {setoresVisiveis.map((s) => {
          const membros = equipe.filter((p) => p.setores.includes(s.id));
          const gestores = membros.filter((p) => p.gestor.includes(s.id));
          const organizaEste = gere.includes(s.id);
          const candidatos = equipe.filter((p) => p.ativo && !p.setores.includes(s.id));
          return (
            <section key={s.id} className="cartao overflow-hidden" aria-label={s.nome}>
              <header className="border-b border-linha px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="lp-display text-xl text-texto">{s.nome}</h2>
                  <span className="text-sm text-texto-2">{membros.filter((m) => m.ativo).length} pessoa(s)</span>
                </div>
                <p className="mt-1 text-sm text-texto-2">
                  {gestores.length ? <>Gestor: <strong className="text-texto">{gestores.map((g) => g.nome).join(", ")}</strong></> : "Sem gestor: só a Diretoria organiza este setor."}
                </p>
              </header>
              <ul className="divide-y divide-linha">
                {membros.map((p) => {
                  const ehGestor = p.gestor.includes(s.id);
                  return (
                    <li key={p.user_id} className={"px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 " + (p.ativo ? "" : "opacity-60")}>
                      <div className="min-w-40 flex-1">
                        <p className="font-semibold text-texto">
                          {p.nome}{p.user_id === souEu && <span className="ml-1.5 text-sm font-normal text-texto-2">(você)</span>}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Funcao key={p.cargo ?? ""} p={p} pode={podeFuncao(p)}
                            salvar={(cargo) => chamar({ acao: "cargo", user_id: p.user_id, cargo })} />
                          {p.email && <span className="text-xs text-texto-2">{p.email}</span>}
                        </div>
                      </div>
                      {ehGestor && <Etiqueta tom="ouro"><Crown className="size-3" /> Gestor</Etiqueta>}
                      {p.acesso === "leitura" && <Etiqueta>Somente leitura</Etiqueta>}
                      {diretoria && !p.gestor.length && <select aria-label={`Perfil de acesso de ${p.nome}`} value={p.acesso}
                        disabled={ocupado} onChange={(e) => chamar({ acao: "acesso", user_id: p.user_id, acesso: e.target.value })}
                        className="rounded-lg border border-linha bg-superficie px-2 py-1 text-xs">
                        <option value="operador">Operador</option><option value="leitura">Somente leitura</option>
                      </select>}
                      {p.recepcao && <Etiqueta tom="verde">Recepção</Etiqueta>}
                      {!p.ativo && <Etiqueta tom="critico">desativado</Etiqueta>}
                      {diretoria && !semMigration && p.ativo && (
                        <button type="button" disabled={ocupado}
                          onClick={() => chamar({ acao: "gestor", user_id: p.user_id, setor: s.id, ligado: !ehGestor })}
                          className="btn-contorno px-3 py-1.5 text-xs disabled:opacity-50">
                          {ehGestor ? "Tirar de gestor" : "Tornar gestor"}
                        </button>
                      )}
                      {organizaEste && p.ativo && p.user_id !== souEu && (
                        <button type="button" disabled={ocupado} title="Gerar um link para a pessoa criar ou trocar a senha"
                          onClick={() => chamar({ acao: "link", user_id: p.user_id }, undefined, p.nome)}
                          className="inline-flex items-center gap-1 rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-texto-2 hover:border-verde/50 hover:text-verde disabled:opacity-50">
                          <Link2 className="size-3.5" /> Gerar link
                        </button>
                      )}
                      {organizaEste && (diretoria || p.user_id !== souEu) && (
                        <button type="button" disabled={ocupado} title={`Retirar o acesso ao setor ${s.nome}`}
                          onClick={() => chamar({ acao: "setor", user_id: p.user_id, setor: s.id, ligado: false }, `${p.nome} saiu de ${s.nome}.`)}
                          className="inline-flex items-center gap-1 rounded-lg border border-linha px-2.5 py-1.5 text-xs font-semibold text-texto-2 hover:border-critico/50 hover:text-critico disabled:opacity-50">
                          <UserMinus className="size-3.5" /> Retirar
                        </button>
                      )}
                    </li>
                  );
                })}
                {!membros.length && <li className="px-5 py-4 text-sm text-texto-2">Ninguém da equipe neste setor ainda.</li>}
              </ul>
              {organizaEste && candidatos.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-linha bg-superficie-2/40 px-5 py-3">
                  <select aria-label={`Liberar ${s.nome} para`} value={adicionar[s.id] ?? ""}
                    onChange={(e) => setAdicionar({ ...adicionar, [s.id]: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-linha-forte bg-superficie-2 px-3 py-2 text-sm text-texto">
                    <option value="">Liberar o setor para…</option>
                    {candidatos.map((c) => <option key={c.user_id} value={c.user_id}>{c.nome}{c.cargo ? ` · ${c.cargo}` : ""}</option>)}
                  </select>
                  <button type="button" disabled={ocupado || !adicionar[s.id]}
                    onClick={async () => {
                      const alvo = candidatos.find((c) => c.user_id === adicionar[s.id]);
                      if (await chamar({ acao: "setor", user_id: adicionar[s.id], setor: s.id, ligado: true }, `${alvo?.nome ?? "Pessoa"} agora acessa ${s.nome}.`)) {
                        setAdicionar({ ...adicionar, [s.id]: "" });
                      }
                    }}
                    className="btn-verde px-4 py-2 text-sm disabled:opacity-50">
                    Liberar
                  </button>
                </div>
              )}
            </section>
          );
        })}

        {!setorUnico && <section className="cartao overflow-hidden" aria-label="Diretoria">
          <header className="border-b border-linha px-5 py-4">
            <h2 className="lp-display text-xl text-texto">Diretoria</h2>
            <p className="mt-1 text-sm text-texto-2">Entra em todos os setores e organiza a equipe inteira.</p>
          </header>
          <ul className="divide-y divide-linha">
            {direcao.map((p) => (
              <li key={p.user_id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-40 flex-1">
                  <p className="font-semibold text-texto">{p.nome}{p.user_id === souEu && <span className="ml-1.5 text-sm font-normal text-texto-2">(você)</span>}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Funcao key={p.cargo ?? ""} p={p} pode={podeFuncao(p)} salvar={(cargo) => chamar({ acao: "cargo", user_id: p.user_id, cargo })} />
                    {p.email && <span className="text-xs text-texto-2">{p.email}</span>}
                  </div>
                </div>
                {p.recepcao && <Etiqueta tom="verde">Recepção</Etiqueta>}
              </li>
            ))}
          </ul>
        </section>}
      </div>
    </div>
  );
}
