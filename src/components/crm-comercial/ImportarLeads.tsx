"use client";

import { useMemo, useState } from "react";
import { CAMPO } from "@/components/ui/Pagina";
import { enviarJson } from "@/lib/api/enviar";
import { TABELA, TABELA_CAIXA, TD, TH, THEAD, TBODY } from "@/components/admin/estilos";
import { ORIGENS_MANUAIS, lerCsv } from "@/lib/crm-comercial";

const COLUNAS: Record<string, string[]> = {
  nome: ["nome", "cliente", "name"],
  telefone: ["telefone", "celular", "whatsapp", "fone", "phone"],
  email: ["email", "e-mail", "mail"],
  codigo_imovel: ["imovel", "imóvel", "codigo", "código", "codigo_imovel", "aib"],
  origem: ["origem", "fonte", "canal"],
  mensagem: ["mensagem", "observacao", "observação", "obs", "interesse"],
  temperatura: ["temperatura"],
  etiquetas: ["etiquetas", "tags"],
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export default function ImportarLeads() {
  const [texto, setTexto] = useState("");
  const [atribuir, setAtribuir] = useState("rodizio");
  const [origemPadrao, setOrigemPadrao] = useState("evento");
  const [ocupado, setOcupado] = useState(false);
  const [res, setRes] = useState<{ criados: number; erros: { linha: number; erro: string }[] } | null>(null);
  const [erro, setErro] = useState("");

  const linhas = useMemo(() => {
    const m = lerCsv(texto);
    if (m.length < 2) return [];
    const cab = m[0].map(semAcento);
    const idx = Object.fromEntries(Object.entries(COLUNAS).map(([k, nomes]) => [k, cab.findIndex((c) => nomes.map(semAcento).includes(c))]));
    return m.slice(1).map((l) => {
      const o: Record<string, string> = {};
      for (const [k, i] of Object.entries(idx)) if (i >= 0) o[k] = l[i] ?? "";
      if (!o.origem) o.origem = origemPadrao;
      return o;
    });
  }, [texto, origemPadrao]);
  const faltaColuna = texto && linhas.length && !("nome" in linhas[0] && "codigo_imovel" in linhas[0]);

  return (
    <div className="space-y-5">
      <div className="cartao space-y-4 p-6">
        <input type="file" accept=".csv,text/csv" aria-label="Arquivo CSV"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) setTexto(await f.text()); }} />
        <textarea className={CAMPO + " min-h-40 font-mono text-xs"} value={texto} onChange={(e) => { setTexto(e.target.value); setRes(null); }}
          placeholder={"nome;telefone;email;imovel;origem\nJoão Silva;(34) 99999-0000;joao@email.com;AIB-000123;evento"} aria-label="Conteúdo do CSV" />
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm font-semibold text-texto">Origem quando a planilha não diz
            <select className={CAMPO} value={origemPadrao} onChange={(e) => setOrigemPadrao(e.target.value)}>
              {ORIGENS_MANUAIS.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-texto">Quem atende
            <select className={CAMPO} value={atribuir} onChange={(e) => setAtribuir(e.target.value)}>
              <option value="rodizio">Rodízio de leads</option>
              <option value="eu">Eu mesmo</option>
            </select>
          </label>
        </div>
      </div>

      {faltaColuna && <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">A planilha precisa das colunas “nome” e “imovel”.</p>}
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}

      {!!linhas.length && !faltaColuna && (
        <>
          <div className={TABELA_CAIXA}>
            <table className={TABELA}>
              <thead className={THEAD}><tr>{["#", "Nome", "Telefone", "E-mail", "Imóvel", "Origem"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody className={TBODY}>
                {linhas.slice(0, 20).map((l, i) => (
                  <tr key={i}>
                    <td className={TD}>{i + 1}</td><td className={TD}>{l.nome}</td><td className={TD}>{l.telefone}</td>
                    <td className={TD}>{l.email}</td><td className={TD}>{l.codigo_imovel}</td><td className={TD}>{l.origem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-texto-2">{linhas.length} linha(s){linhas.length > 20 ? ", mostrando as 20 primeiras" : ""}.</p>
          <button disabled={ocupado || linhas.length > 500} className="lp-btn lp-btn-verde !px-6 !py-3 disabled:opacity-50"
            onClick={async () => {
              setOcupado(true); setErro(""); setRes(null);
              const r = await enviarJson<{ criados: number; erros: { linha: number; erro: string }[] }>("/api/admin/crm-comercial/leads", "POST", { linhas, atribuir });
              setOcupado(false);
              if (!r.ok) setErro(r.erro.mensagem); else setRes(r.dados);
            }}>
            {ocupado ? "Importando…" : linhas.length > 500 ? "Máximo de 500 linhas" : `Importar ${linhas.length} lead(s)`}
          </button>
        </>
      )}

      {res && (
        <div className="cartao space-y-2 p-5 text-sm">
          <p className="font-semibold text-verde">{res.criados} lead(s) importado(s).</p>
          {!!res.erros.length && (
            <ul className="list-disc space-y-1 pl-5 text-critico">
              {res.erros.slice(0, 50).map((e) => <li key={e.linha}>Linha {e.linha}: {e.erro}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
