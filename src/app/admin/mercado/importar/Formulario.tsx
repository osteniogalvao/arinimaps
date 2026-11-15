"use client";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUTOS } from "@/lib/mercado/formato";
import { ESTADOS } from "@/lib/mercado/pracas";
import { LIMITE_CSV, PRODUTOS_IMPORTACAO, type PreviaCotacoes } from "@/lib/mercado/importacao";

export default function Formulario() {
  const router = useRouter();
  const [csv, setCsv] = useState(""),
    [arquivo, setArquivo] = useState(""),
    [previa, setPrevia] = useState<PreviaCotacoes | null>(null);
  const [autorizado, setAutorizado] = useState(false),
    [aviso, setAviso] = useState(""),
    [ocupado, setOcupado] = useState(false),
    [chave, setChave] = useState("");
  function limparPrevia() {
    setPrevia(null);
    setAutorizado(false);
    setAviso("");
  }
  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const serie = Object.fromEntries(
      ["codigo", "produto", "nome", "praca", "uf", "unidade", "fonte", "url"].map((k) => [k, form.get(k)]),
    );
    const id = previa ? chave : crypto.randomUUID();
    setChave(id);
    setOcupado(true);
    setAviso("");
    try {
      const r = await fetch("/api/admin/mercado/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: previa ? "publicar" : "prever",
          chave: id,
          serie,
          arquivo: arquivo || "Dados colados",
          csv,
          autorizacao: form.get("autorizacao"),
          autorizado,
          revisao: previa?.revisao,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (r.status === 409) limparPrevia();
        throw Error(j.error || "Falha ao consultar o arquivo.");
      }
      if (j.publicado) {
        setPrevia(null);
        setAutorizado(false);
        setAviso("Importação concluída. " + j.novas + " novas datas e " + j.corrigidas + " correções.");
        router.refresh();
      } else {
        setPrevia(j);
        setAutorizado(false);
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="cartao space-y-4 p-5" onSubmit={enviar}>
      <fieldset disabled={ocupado} onChange={limparPrevia} className="grid gap-3 sm:grid-cols-2">
        <label>
          Código permanente da série
          <input
            className={CAMPO_COMPACTO + " mt-1 block w-full"}
            required
            name="codigo"
            pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]"
            maxLength={60}
            placeholder="vacas-triangulo-fornecedor"
          />
        </label>
        <label>
          Produto
          <select className={CAMPO_COMPACTO + " mt-1 block w-full"} required name="produto" defaultValue="">
            <option value="">Selecione</option>
            {PRODUTOS_IMPORTACAO.map((id) => (
              <option key={id} value={id}>
                {PRODUTOS[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nome público do indicador
          <input required name="nome" maxLength={110} className={CAMPO_COMPACTO + " mt-1 block w-full"} />
        </label>
        <label>
          Unidade
          <input
            required
            name="unidade"
            maxLength={35}
            placeholder="R$/@"
            className={CAMPO_COMPACTO + " mt-1 block w-full"}
          />
        </label>
        <label>
          Praça ou região
          <input required name="praca" maxLength={110} className={CAMPO_COMPACTO + " mt-1 block w-full"} />
        </label>
        <label>
          UF
          <select className={CAMPO_COMPACTO + " mt-1 block w-full"} required name="uf" defaultValue="">
            <option value="">Selecione</option>
            {Object.entries(ESTADOS).map(([uf, nome]) => (
              <option value={uf} key={uf}>
                {nome} ({uf})
              </option>
            ))}
          </select>
        </label>
        <label>
          Fonte dos valores
          <input required name="fonte" maxLength={110} className={CAMPO_COMPACTO + " mt-1 block w-full"} />
        </label>
        <label>
          URL pública da fonte
          <input
            required
            name="url"
            type="url"
            maxLength={600}
            placeholder="https://"
            className={CAMPO_COMPACTO + " mt-1 block w-full"}
          />
        </label>
        <label className="sm:col-span-2">
          Autorização para publicação comercial
          <textarea
            required
            name="autorizacao"
            minLength={10}
            maxLength={500}
            rows={2}
            placeholder="Identifique o contrato, licença ou responsável pela coleta própria. Esta referência fica restrita à equipe."
            className={CAMPO_COMPACTO + " mt-1 block w-full"}
          />
        </label>
        <label className="sm:col-span-2">
          Arquivo CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className={CAMPO_COMPACTO + " mt-1 block w-full"}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > LIMITE_CSV) {
                setCsv("");
                setArquivo("");
                setAviso("O arquivo pode ter até 65 KB.");
                return;
              }
              try {
                const t = await f.text();
                setCsv(t);
                setArquivo(f.name);
              } catch {
                setCsv("");
                setArquivo("");
                setAviso("Não foi possível ler o arquivo.");
              }
            }}
          />
        </label>
        <label className="sm:col-span-2">
          Conteúdo do CSV
          <textarea
            required
            name="csv"
            className={CAMPO_COMPACTO + " mt-1 block w-full font-mono"}
            rows={5}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setArquivo("");
            }}
            placeholder="data;valor"
          />
        </label>
        <p className="text-sm text-texto-2 sm:col-span-2">
          Use o cabeçalho data;valor e uma linha por data no formato AAAA-MM-DD. Use até quatro decimais e até
          mil datas. O mesmo código acrescenta ou corrige pontos daquela série.
        </p>
      </fieldset>
      {previa && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Prévia da publicação</h2>
          <p>
            {previa.slug} · {previa.novas} datas novas · {previa.corrigidas} correções · {previa.iguais} sem
            alteração
          </p>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm [&_th]:pb-2 [&_th]:pr-3 [&_td]:py-1 [&_td]:pr-3">
              <caption className="text-left">
                Primeiras {previa.amostra.length} de {previa.total} datas
              </caption>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor atual</th>
                  <th>Valor do arquivo</th>
                </tr>
              </thead>
              <tbody>
                {previa.amostra.map((p) => (
                  <tr key={p.data}>
                    <td>{p.data}</td>
                    <td>{p.anterior ?? "—"}</td>
                    <td>{p.valor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex gap-2">
            <input type="checkbox" checked={autorizado} onChange={(e) => setAutorizado(e.target.checked)} />
            Conferi os valores e a autorização para publicação comercial desta fonte.
          </label>
        </section>
      )}
      <button
        className="btn-verde px-4 py-2 disabled:opacity-50"
        disabled={ocupado || (!!previa && !autorizado)}
      >
        {ocupado ? "Aguarde…" : previa ? "Publicar esta importação" : "Conferir prévia"}
      </button>
      <p role="status">{aviso}</p>
    </form>
  );
}
