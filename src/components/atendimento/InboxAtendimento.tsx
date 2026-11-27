import Link from "next/link";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { canalDoContatoRotulo, contatoRotulo, nomeSetor, PERFIL_LABEL, STATUS_LABEL } from "@/lib/atendimento-rotulos";
import ConversaAtendimento from "@/components/atendimento/ConversaAtendimento";
import type { Conversa } from "@/lib/atendimento";

const FUSO = "America/Sao_Paulo";
const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: FUSO }) === d.toLocaleDateString("pt-BR", { timeZone: FUSO });
  return d.toLocaleString("pt-BR", hoje ? { timeZone: FUSO, timeStyle: "short" } : { timeZone: FUSO, day: "2-digit", month: "2-digit" });
};
/** Igual a naAutomatica (lib/atendimento), sem trazer o servidor para cá. */
const naAutomatica = (c: Conversa) => !c.setor && !c.responsavel && (!!c.ari_ativa_em || (!!c.menu_enviado_em && !c.menu_respondido_em));

export type Caixa = { id: string; rotulo: string; total?: number; naoLidas?: number };

/**
 * Caixa de entrada do Atendimento no desenho do atendimento da Arini Negócios
 * (estilo Chatwoot): caixas à esquerda, lista de conversas no meio e a
 * conversa aberta à direita, tudo num só cartão.
 */
export default function InboxAtendimento({ papel, triagem, diretoria, caixas, caixa, busca, conversas, nomes, aberta }: {
  papel: string; triagem: boolean; diretoria: boolean; caixas: Caixa[]; caixa: string; busca: string;
  conversas: Conversa[]; nomes: Record<string, string>; aberta: string | null;
}) {
  const nomeDe = new Map(Object.entries(nomes));
  const link = (extra: Record<string, string>) => "?" + new URLSearchParams({ caixa, ...(busca ? { q: busca } : {}), ...extra }).toString();
  const caixaAtual = caixas.find((c) => c.id === caixa);
  const letra = (n: string) => (n.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="lp-display text-2xl text-texto">Atendimento</h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-texto-2">
          <span>Você atua como <strong className="text-texto">{papel === "administrador" ? "administrador" : papel === "recepcao" ? "recepção" : "atendente"}</strong></span>
          {triagem && <Link href="/admin/atendimento/relatorios" className="font-semibold text-verde underline-offset-4 hover:underline">Relatórios</Link>}
          {diretoria && <Link href="/admin/atendimento/configurar" className="font-semibold text-verde underline-offset-4 hover:underline">Configurações</Link>}
          {diretoria && <Link href="/admin/comercial/whatsapp/conexao" className="font-semibold text-verde underline-offset-4 hover:underline">Canais</Link>}
        </p>
      </div>
      <div className="cartao grid min-h-[78vh] overflow-hidden !p-0 lg:grid-cols-[210px_320px_minmax(0,1fr)]">
        {/* caixas */}
        <nav aria-label="Caixas" className={"border-linha bg-superficie-2/40 py-2 lg:border-r " + (aberta ? "hidden lg:block" : "")}>
          {caixas.map((c) => (
            <Link key={c.id} href={"?" + new URLSearchParams({ caixa: c.id }).toString()}
              className={"mx-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors " + (c.id === caixa ? "bg-verde text-white font-semibold" : "text-texto-2 hover:bg-superficie-2 hover:text-texto")}>
              <span className="truncate">{c.rotulo}</span>
              {c.total !== undefined && (
                <span className="flex shrink-0 items-center gap-1.5">
                  {!!c.naoLidas && <span className="rounded-full bg-ouro px-1.5 text-[11px] font-bold text-fundo">{c.naoLidas}</span>}
                  <span className={"tabular-nums text-xs " + (c.id === caixa ? "text-white/80" : "")}>{c.total}</span>
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* lista */}
        <aside className={"flex flex-col border-linha lg:border-r " + (aberta ? "hidden lg:flex" : "")}>
          <div className="space-y-2 border-b border-linha p-3">
            <p className="flex items-center justify-between font-semibold text-texto">
              <span className="truncate">{caixaAtual?.rotulo ?? "Conversas"}</span>
              <span className="rounded-full bg-superficie-2 px-2 text-xs tabular-nums text-texto-2">{conversas.length}</span>
            </p>
            <form className="flex gap-2">
              <input type="hidden" name="caixa" value={caixa} />
              <input name="q" defaultValue={busca} placeholder="Buscar por nome, telefone ou código…" className={CAMPO_COMPACTO + " flex-1"} aria-label="Buscar conversa" />
            </form>
          </div>
          <ul className="max-h-[70vh] flex-1 divide-y divide-linha overflow-y-auto">
            {conversas.map((c) => {
              const nome = c.nome || contatoRotulo(c.telefone);
              return (
                <li key={c.id}>
                  <Link href={link({ conversa: c.id })}
                    className={"flex gap-3 px-3 py-3 transition-colors " + (c.id === aberta ? "bg-verde/12" : "hover:bg-superficie-2")}>
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-verde/15 font-semibold text-verde">
                      {letra(nome)}
                      {!!c.nao_lidas && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-ouro px-1 text-[10px] font-bold text-fundo">{c.nao_lidas}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={"truncate text-sm " + (c.nao_lidas ? "font-bold text-texto" : "font-semibold text-texto")}>{nome}</span>
                        <span className="shrink-0 text-[11px] text-texto-2">{quando(c.ultima_mensagem_em)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-texto-2">{c.ultimo_texto}</span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[10px] text-texto-2">
                        <span className={"rounded px-1.5 font-semibold " + (c.status === "pendente" ? "bg-ouro/15 text-ouro" : "bg-verde/12 text-verde")}>{c.status === "pendente" ? STATUS_LABEL.pendente : naAutomatica(c) ? (c.ari_ativa_em ? "Com a Ari" : "No menu") : nomeSetor(c.setor)}</span>
                        <span>{canalDoContatoRotulo(c.telefone)}</span>
                        {c.responsavel && <span className="ml-auto truncate">{nomeDe.get(c.responsavel) ?? "Responsável"}</span>}
                        {!c.responsavel && c.perfil_tipo && <span className="ml-auto">{PERFIL_LABEL[c.perfil_tipo] ?? c.perfil_tipo}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {!conversas.length && <li className="px-4 py-10 text-center text-sm text-texto-2">Nenhuma conversa nesta caixa.</li>}
          </ul>
        </aside>

        {/* conversa */}
        <section className={aberta ? "" : "hidden lg:flex"}>
          {aberta
            ? <ConversaAtendimento key={aberta} id={aberta} voltar={link({})} />
            : <p className="m-auto px-5 py-16 text-center text-sm text-texto-2">Escolha uma conversa à esquerda.</p>}
        </section>
      </div>
    </div>
  );
}
