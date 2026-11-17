"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Flame, MessageCircle, Mail, PhoneCall, Tags, Send } from "lucide-react";
import { CAMPO } from "@/components/ui/Pagina";
import { enviarJson } from "@/lib/api/enviar";
import {
  INTERACOES, TEMPERATURAS, TEMPERATURA_LABEL, linkEmail, linkWhatsApp, preencherModelo, type Temperatura,
} from "@/lib/crm-comercial";

export type ModeloMensagem = { id: string; titulo: string; canal: string; assunto: string | null; texto: string; etapa: string | null };

type Props = {
  oportunidadeId: string;
  codigo: string;
  etapa: string;
  cliente: { nome: string; telefone: string | null; email: string | null };
  imovel: { codigo: string; titulo: string } | null;
  corretor: string | null;
  temperatura: string | null;
  etiquetas: string[];
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  ultimoContatoEm: string | null;
  modelos: ModeloMensagem[];
  /** sem a migration 0147, o painel avisa em vez de falhar a cada clique */
  semMigration?: boolean;
};

const COR_TEMP: Record<Temperatura, string> = {
  quente: "border-critico bg-critico/12 text-critico",
  morno: "border-ouro bg-ouro/14 text-ouro",
  frio: "border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-300",
};

/** valor de <input type="datetime-local"> no fuso do navegador */
function paraCampo(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50";

/** Painel do CRM na oportunidade: classificação, próxima ação, registro de contato e mensagens prontas. */
export default function PainelCrm(p: Props) {
  const router = useRouter();
  const [agora] = useState(() => Date.now());
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [etiquetas, setEtiquetas] = useState(p.etiquetas.join(", "));
  const [acao, setAcao] = useState(p.proximaAcao ?? "");
  const [quando, setQuando] = useState(paraCampo(p.proximaAcaoEm));
  const [tipo, setTipo] = useState("ligacao");
  const [texto, setTexto] = useState("");
  const [novaAcao, setNovaAcao] = useState("");
  const [novaQuando, setNovaQuando] = useState("");
  const [modelo, setModelo] = useState(p.modelos.find((m) => m.etapa === p.etapa)?.id ?? p.modelos[0]?.id ?? "");

  async function enviar(body: Record<string, unknown>, sucesso: string) {
    setOcupado(true); setErro(""); setOk("");
    const r = await enviarJson(`/api/admin/crm-comercial/oportunidades/${p.oportunidadeId}`, "PATCH", body);
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return false; }
    setOk(sucesso);
    router.refresh();
    return true;
  }
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);

  const m = p.modelos.find((x) => x.id === modelo);
  const vars = { nome: p.cliente.nome, imovel: p.imovel?.titulo ?? "", codigo: p.imovel?.codigo ?? "", corretor: p.corretor, oportunidade: p.codigo };
  const mensagem = m ? preencherModelo(m.texto, vars) : "";
  const zap = m && m.canal !== "email" ? linkWhatsApp(p.cliente.telefone, mensagem) : null;
  const mail = m && m.canal !== "whatsapp" ? linkEmail(p.cliente.email, preencherModelo(m.assunto ?? `Imóvel ${p.imovel?.codigo ?? ""}`, vars), mensagem) : null;
  const atrasada = p.proximaAcaoEm && +new Date(p.proximaAcaoEm) < agora;

  if (p.semMigration) {
    return (
      <section className="cartao p-5 text-sm text-texto-2">
        O painel do CRM (temperatura, próxima ação, contatos e mensagens prontas) aparece depois da migration 0147.
      </section>
    );
  }

  return (
    <section className="cartao space-y-6 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-texto"><Flame className="size-5 text-ouro" /> CRM do lead</h2>
        <p className="text-xs text-texto-2">
          Último contato: {p.ultimoContatoEm ? new Date(p.ultimoContatoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nenhum registrado"}
        </p>
      </div>
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-2.5 text-sm text-critico">{erro}</p>}
      {ok && !erro && <p className="rounded-xl border border-verde/30 bg-verde/10 px-4 py-2.5 text-sm text-verde">{ok}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* temperatura e etiquetas */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-texto">Temperatura</p>
          <div className="flex flex-wrap gap-2">
            {TEMPERATURAS.map((t) => (
              <button key={t} type="button" disabled={ocupado} aria-pressed={p.temperatura === t}
                onClick={() => enviar({ acao: "classificar", temperatura: p.temperatura === t ? null : t }, "Temperatura salva.")}
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${p.temperatura === t ? COR_TEMP[t] : "border-linha text-texto-2 hover:border-linha-forte"}`}>
                {TEMPERATURA_LABEL[t]}
              </button>
            ))}
          </div>
          <label className="block text-sm font-semibold text-texto" htmlFor="crm-etiquetas"><Tags className="mr-1 inline size-4" />Etiquetas</label>
          <div className="flex gap-2">
            <input id="crm-etiquetas" className={CAMPO} value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)}
              placeholder="investidor, pecuária, financiamento" maxLength={400} />
            <button type="button" disabled={ocupado} className={`${btn} btn-contorno`}
              onClick={() => enviar({ acao: "classificar", etiquetas }, "Etiquetas salvas.")}>Salvar</button>
          </div>
        </div>

        {/* próxima ação */}
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-texto">
            <CalendarClock className="size-4" /> Próxima ação
            {atrasada && <span className="rounded-full bg-critico/12 px-2 py-0.5 text-xs text-critico">atrasada</span>}
          </p>
          <input className={CAMPO} value={acao} onChange={(e) => setAcao(e.target.value)} maxLength={200}
            placeholder="Ex.: ligar para confirmar a visita" aria-label="Próxima ação" />
          <div className="flex flex-wrap gap-2">
            <input type="datetime-local" className={CAMPO + " max-w-60"} value={quando} onChange={(e) => setQuando(e.target.value)} aria-label="Quando" />
            <button type="button" disabled={ocupado} className={`${btn} lp-btn lp-btn-verde`}
              onClick={() => enviar({ acao: "proxima_acao", texto: acao, quando: iso(quando) }, acao ? "Próxima ação agendada." : "Próxima ação limpa.")}>
              {acao ? "Agendar" : "Limpar"}
            </button>
          </div>
        </div>
      </div>

      {/* registrar contato */}
      <div className="space-y-3 border-t border-linha pt-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-texto"><PhoneCall className="size-4" /> Registrar contato</p>
        <div className="flex flex-wrap gap-2">
          {INTERACOES.map((i) => (
            <button key={i.id} type="button" onClick={() => setTipo(i.id)} aria-pressed={tipo === i.id}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${tipo === i.id ? "border-verde bg-verde text-fundo" : "border-linha text-texto-2 hover:border-linha-forte"}`}>
              {i.rotulo}
            </button>
          ))}
        </div>
        <textarea className={CAMPO + " min-h-24"} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000}
          placeholder="O que foi conversado? Interesse, objeções, combinados." aria-label="Resumo do contato" />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input className={CAMPO} value={novaAcao} onChange={(e) => setNovaAcao(e.target.value)} maxLength={200}
            placeholder="Próximo passo (opcional)" aria-label="Próximo passo" />
          <input type="datetime-local" className={CAMPO} value={novaQuando} onChange={(e) => setNovaQuando(e.target.value)} aria-label="Data do próximo passo" />
          <button type="button" disabled={ocupado || !texto.trim()} className={`${btn} lp-btn lp-btn-verde`}
            onClick={async () => {
              const feito = await enviar({ acao: "interacao", tipo, texto, proxima_acao: novaAcao, quando: iso(novaQuando), concluir_proxima: !novaAcao && !!p.proximaAcao },
                "Contato registrado na linha do tempo.");
              if (feito) { setTexto(""); setNovaAcao(""); setNovaQuando(""); }
            }}>
            <Send className="size-4" /> Registrar
          </button>
        </div>
      </div>

      {/* mensagens prontas */}
      {!!p.modelos.length && (
        <div className="space-y-3 border-t border-linha pt-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-texto"><MessageCircle className="size-4" /> Mensagem pronta</p>
          <select className={CAMPO} value={modelo} onChange={(e) => setModelo(e.target.value)} aria-label="Modelo de mensagem">
            {p.modelos.map((x) => <option key={x.id} value={x.id}>{x.titulo}{x.canal === "email" ? " (e-mail)" : ""}</option>)}
          </select>
          {m && <p className="whitespace-pre-wrap rounded-xl border border-linha bg-superficie-2/60 p-4 text-sm text-texto">{mensagem}</p>}
          <div className="flex flex-wrap gap-2">
            {zap && <a href={zap} target="_blank" rel="noopener noreferrer" className={`${btn} lp-btn lp-btn-verde`}><MessageCircle className="size-4" /> Abrir no WhatsApp</a>}
            {mail && <a href={mail} className={`${btn} btn-contorno`}><Mail className="size-4" /> Abrir no e-mail</a>}
            {m && !zap && !mail && <p className="text-sm text-texto-2">O cliente não tem {m.canal === "email" ? "e-mail" : "telefone"} cadastrado.</p>}
            {m && (zap || mail) && (
              <button type="button" disabled={ocupado} className={`${btn} btn-contorno`}
                onClick={() => enviar({ acao: "interacao", tipo: m.canal === "email" ? "email" : "whatsapp", texto: `Mensagem "${m.titulo}" enviada.` }, "Envio registrado.")}>
                Marcar como enviada
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
