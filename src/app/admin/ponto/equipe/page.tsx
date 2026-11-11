import { Download } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { diaSP, horaSP } from "@/lib/ponto";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { Secao } from "@/components/admin/Painel";
import { LISTA, LISTA_VAZIA } from "@/components/admin/estilos";
import DecidirAjuste from "@/components/ponto/DecidirAjuste";
import JornadaForm from "@/components/ponto/JornadaForm";

const AJUSTE_LABEL: Record<string, string> = { incluir: "Incluir marcação", desconsiderar: "Desconsiderar marcação", abono: "Abonar o dia" };

/** Ponto da equipe (Diretoria): quem já marcou hoje, ajustes para decidir e jornadas. */
export default async function PontoEquipe() {
  await exigirSetor("diretoria");
  const admin = supabaseAdmin();
  const hoje = diaSP(new Date());
  const mes = hoje.slice(0, 7);
  const [{ data: equipe }, { data: jornadas }, { data: hojeMarc }, { data: pendentes }] = await Promise.all([
    admin.from("profiles").select("user_id, nome").in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome"),
    admin.from("ponto_jornadas").select("*"),
    admin.from("ponto_marcacoes").select("user_id, marcado_em").gte("marcado_em", new Date(`${hoje}T00:00:00-03:00`).toISOString()).order("marcado_em"),
    admin.from("ponto_ajustes").select("*").eq("status", "pendente").order("created_at"),
  ]);
  const nome = new Map((equipe ?? []).map((m) => [m.user_id, m.nome || "—"]));
  const jornadaDe = new Map((jornadas ?? []).map((j) => [j.user_id, j]));
  const marcHoje = new Map<string, string[]>();
  for (const m of hojeMarc ?? []) marcHoje.set(m.user_id, [...(marcHoje.get(m.user_id) ?? []), horaSP(m.marcado_em)]);

  return (
    <div className="max-w-6xl space-y-8">
      <CabecalhoPagina eyebrow="Diretoria" titulo="Ponto da equipe"
        subtitulo="Marcações não se alteram: correção só por ajuste aprovado, e cada marcação guarda o código da anterior. Para valer como ponto oficial perante a fiscalização (Portaria 671/2021), o sistema ainda precisa do registro no INPI e do certificado; até lá, use como controle interno." />

      <Secao titulo="Ajustes para decidir">
        <div className={LISTA}>
          {(pendentes ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-texto">{nome.get(a.user_id)} · {AJUSTE_LABEL[a.tipo]}</span>
                <span className="mt-0.5 block text-xs text-texto-2">
                  {new Date(`${a.data}T12:00:00`).toLocaleDateString("pt-BR")}{a.horario ? ` às ${horaSP(a.horario)}` : ""} · {a.motivo}
                </span>
              </span>
              <DecidirAjuste id={a.id} />
            </div>
          ))}
          {!pendentes?.length && <p className={LISTA_VAZIA}>Nenhum ajuste esperando.</p>}
        </div>
      </Secao>

      <Secao titulo="Equipe hoje e jornadas">
        <div className={LISTA}>
          {(equipe ?? []).map((m) => (
            <div key={m.user_id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-texto">{m.nome || "—"}</span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="tabular-nums text-texto-2">{marcHoje.get(m.user_id)?.join(" · ") ?? "sem marcação hoje"}</span>
                  <a href={`/api/admin/ponto/exportar?mes=${mes}&user=${m.user_id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-verde hover:underline"><Download className="size-3.5" /> Espelho</a>
                  <a href={`/api/admin/ponto/exportar?mes=${mes}&user=${m.user_id}&formato=marcacoes`} className="text-xs font-semibold text-verde hover:underline">Marcações</a>
                </span>
              </div>
              <JornadaForm userId={m.user_id} inicial={jornadaDe.get(m.user_id) ?? null} />
            </div>
          ))}
        </div>
      </Secao>
    </div>
  );
}
