import { Trash2 } from "lucide-react";
import { SETORES, setorPorId } from "@/lib/setores";
import { PRAZO_PADRAO, type PrazoSetor } from "@/lib/matriz";
import { TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";

const CAMPO_N = "w-16 rounded-lg border border-linha bg-superficie px-2 py-1.5 text-sm tabular-nums text-texto";

type Acao = (form: FormData) => Promise<void>;

/**
 * Editor de prazos e limites da Matriz (Diretoria). Uma linha por setor e,
 * embaixo, as exceções por tipo de tarefa (regra que a gerou).
 */
export default function PrazosMatriz({ linhas, tipos, salvar, remover }: {
  linhas: PrazoSetor[]; tipos: string[]; salvar: Acao; remover: Acao;
}) {
  const padrao = new Map(linhas.filter((l) => !l.regra).map((l) => [l.setor, l]));
  const excecoes = linhas.filter((l) => l.regra);
  return (
    <div className="space-y-4">
      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}><tr>
            <th className={TH}>Setor</th><th className={TH}>Prazo (dias)</th><th className={TH}>Limite (dias)</th>
            <th className={TH}>Atenção</th><th className={TH}>Crítico</th><th className={TH}></th>
          </tr></thead>
          <tbody className={TBODY}>
            {SETORES.map((s) => {
              const p = padrao.get(s.id) ?? { setor: s.id, regra: "", ...PRAZO_PADRAO };
              const id = `prazo-${s.id}`;
              return (
                <tr key={s.id} className={TR}>
                  <td className={TD + " font-medium text-texto"}>
                    {s.nome}
                    <form id={id} action={salvar}><input type="hidden" name="setor" value={s.id} /><input type="hidden" name="regra" value="" /></form>
                  </td>
                  {/* os campos pertencem ao formulário da linha pelo atributo form */}
                  <NumerosForm p={p} form={id} />
                  <td className={TD}><button form={id} className="btn-verde px-3 py-1.5 text-xs">Salvar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-texto">Exceções por tipo de tarefa</h3>
        <p className="text-sm text-texto-2">Um tipo (a regra que criou a tarefa) pode ter prazo e limite próprios dentro do setor.</p>
        {excecoes.length > 0 && (
          <div className={TABELA_CAIXA}>
            <table className={TABELA}>
              <thead className={THEAD}><tr>
                <th className={TH}>Setor</th><th className={TH}>Tipo</th><th className={TH}>Prazo</th><th className={TH}>Limite</th>
                <th className={TH}>Atenção</th><th className={TH}>Crítico</th><th className={TH}></th>
              </tr></thead>
              <tbody className={TBODY}>
                {excecoes.map((e) => {
                  const id = `excecao-${e.setor}-${e.regra}`;
                  return (
                    <tr key={id} className={TR}>
                      <td className={TD}>
                        {setorPorId(e.setor)?.nome ?? e.setor}
                        <form id={id} action={salvar}><input type="hidden" name="setor" value={e.setor} /><input type="hidden" name="regra" value={e.regra} /></form>
                      </td>
                      <td className={TD + " font-mono text-xs"}>{e.regra}</td>
                      <NumerosForm p={e} form={id} />
                      <td className={TD}>
                        <span className="flex gap-2">
                          <button form={id} className="btn-verde px-3 py-1.5 text-xs">Salvar</button>
                          <form action={remover}>
                            <input type="hidden" name="setor" value={e.setor} /><input type="hidden" name="regra" value={e.regra} />
                            <button className="rounded-lg border border-linha p-1.5 text-texto-2 hover:text-critico" aria-label="Remover exceção"><Trash2 className="size-4" /></button>
                          </form>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <form action={salvar} className="cartao flex flex-wrap items-end gap-3 p-4 text-sm">
          <label className="flex flex-col gap-1">Setor
            <select name="setor" className="rounded-lg border border-linha bg-superficie px-2 py-1.5 text-texto">
              {SETORES.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">Tipo
            <input name="regra" list="tipos-tarefa" required pattern="[a-z0-9_]+" maxLength={60} placeholder="ex.: cadastro_parado"
              className="w-48 rounded-lg border border-linha bg-superficie px-2 py-1.5 font-mono text-xs text-texto" />
            <datalist id="tipos-tarefa">{tipos.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          {([["prazo_dias", "Prazo", 0, PRAZO_PADRAO.prazo_dias], ["limite_dias", "Limite", 0, PRAZO_PADRAO.limite_dias],
             ["atencao", "Atenção", 0, PRAZO_PADRAO.atencao], ["critico", "Crítico", 1, PRAZO_PADRAO.critico]] as const).map(([nome, rotulo, min, valor]) => (
            <label key={nome} className="flex flex-col gap-1">{rotulo}
              <input className={CAMPO_N} type="number" name={nome} min={min} max={365} defaultValue={valor} required />
            </label>
          ))}
          <button className="btn-verde px-4 py-2 text-sm">Adicionar exceção</button>
        </form>
      </div>
    </div>
  );
}

function NumerosForm({ p, form }: { p: Pick<PrazoSetor, "prazo_dias" | "limite_dias" | "atencao" | "critico">; form: string }) {
  return (
    <>
      <td className={TD}><input form={form} className={CAMPO_N} type="number" name="prazo_dias" min={0} max={365} defaultValue={p.prazo_dias} aria-label="Prazo em dias" /></td>
      <td className={TD}><input form={form} className={CAMPO_N} type="number" name="limite_dias" min={0} max={365} defaultValue={p.limite_dias} aria-label="Limite em dias" /></td>
      <td className={TD}><input form={form} className={CAMPO_N} type="number" name="atencao" min={0} max={999} defaultValue={p.atencao} aria-label="Vencidas para atenção" /></td>
      <td className={TD}><input form={form} className={CAMPO_N} type="number" name="critico" min={1} max={999} defaultValue={p.critico} aria-label="Vencidas para crítico" /></td>
    </>
  );
}
