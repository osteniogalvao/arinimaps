"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileArchive, UploadCloud } from "lucide-react";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro, AvisoOk } from "@/components/ui/Aviso";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
// só os nomes dos temas no carregamento; o leitor (jszip + proj4, ~340 KB)
// vem com await import() quando o arquivo é escolhido
import { TEMAS_CAR, type TemaCar } from "@/lib/geo/temasCar";
import type { ArquivoLido } from "@/lib/geo/shapefileCar";

const MB = 1024 * 1024;
const fmt = (n: number) => n.toLocaleString("pt-BR");
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

type Municipio = { cod_ibge: number; nome: string; uf: string; cobertura: { data_base: string; temas: string[] } | null };
type Contagem = { lidos: number; gravados: number; duplicados: number; invalidos: number; corrigidos: number };
type Fim = { id: string; municipio: string; status: string; porTema: Record<string, Contagem> };

/**
 * Importação manual do arquivo do SICAR (PENDENCIAS 3.5): a pessoa baixa o zip
 * do município na base de downloads (com o CAPTCHA, à mão), solta aqui, confere
 * o que foi lido e importa. O arquivo nunca sobe inteiro: o navegador lê, e o
 * servidor recebe as feições em lotes.
 */
export default function ImportarCar() {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [lido, setLido] = useState<ArquivoLido | null>(null);
  const [sha, setSha] = useState("");
  const [codIbge, setCodIbge] = useState("");
  const [municipio, setMunicipio] = useState<Municipio | null>(null);
  const [dataBase, setDataBase] = useState(hoje());
  const [forcar, setForcar] = useState(false);
  const [fase, setFase] = useState<"parado" | "lendo" | "enviando" | "concluindo">("parado");
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0, tema: "" });
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [fim, setFim] = useState<Fim | null>(null);
  // troca a cada importação concluída: o campo de arquivo volta vazio
  const [campoArquivo, setCampoArquivo] = useState(0);

  const ocupado = fase !== "parado";
  const camadasValidas = (lido?.camadas ?? []).filter((c) => c.tema && c.feicoes.length);
  const totalFeicoes = camadasValidas.reduce((s, c) => s + c.feicoes.length, 0);

  async function buscarMunicipio(cod: string) {
    setMunicipio(null);
    if (!/^\d{7}$/.test(cod)) return;
    const r = await fetch(`/api/admin/car/importacoes?municipio=${cod}`).catch(() => null);
    if (r?.ok) setMunicipio(await r.json());
  }

  async function escolher(lista: File[]) {
    setArquivos(lista); setLido(null); setErro(null); setFim(null); setMunicipio(null); setForcar(false);
    if (!lista.length) return;
    setFase("lendo");
    try {
      const { lerArquivoSicar, hashArquivos } = await import("@/lib/geo/shapefileCar");
      const [l, h] = await Promise.all([lerArquivoSicar(lista), hashArquivos(lista)]);
      setLido(l); setSha(h);
      const cod = l.codIbge ? String(l.codIbge) : "";
      setCodIbge(cod);
      await buscarMunicipio(cod);
    } catch (e) {
      setErro({
        status: 0, codigo: "leitura", mensagem: "Não consegui ler o arquivo.",
        motivo: e instanceof Error ? e.message : String(e),
        solucao: "Confira se é o zip baixado da base de downloads do SICAR, sem alterações.",
      });
    } finally {
      setFase("parado");
    }
  }

  async function importar() {
    if (!lido || !municipio) return;
    setErro(null); setFim(null); setFase("enviando");
    const temas: Record<string, number> = {};
    for (const c of camadasValidas) temas[c.tema!] = (temas[c.tema!] ?? 0) + c.feicoes.length;
    const avisos = [
      ...lido.avisos,
      ...lido.camadas.flatMap((c) => c.descartadas.map((d) => `${c.nome}, registro ${d.indice}: ${d.motivo}`)),
    ];

    const aberta = await enviarJson<{ id: string; municipio: string }>("/api/admin/car/importacoes", "POST", {
      cod_ibge: municipio.cod_ibge, arquivo_nome: arquivos.map((a) => a.name).join(", "),
      arquivo_bytes: arquivos.reduce((s, a) => s + a.size, 0), arquivo_sha256: sha,
      data_base: dataBase, temas, avisos, forcar,
    });
    if (!aberta.ok) { setErro(aberta.erro); setFase("parado"); return; }
    const id = aberta.dados.id;

    const { emLotes } = await import("@/lib/geo/shapefileCar"); // já em cache: carregou na leitura
    const porTema: Record<string, Contagem> = {};
    let feitos = 0;
    for (const c of camadasValidas) {
      const tema = c.tema as TemaCar;
      for (const lote of emLotes(c.feicoes)) {
        setProgresso({ feitos, total: totalFeicoes, tema: TEMAS_CAR[tema] });
        let r = await enviarJson<Contagem>(`/api/admin/car/importacoes/${id}/lote`, "POST", { tema, inicio: lote.inicio, feicoes: lote.feicoes });
        // rede instável: duas novas tentativas antes de desistir do lote
        for (let t = 0; !r.ok && r.erro.status === 0 && t < 2; t++) {
          await new Promise((ok) => setTimeout(ok, 2000 * (t + 1)));
          r = await enviarJson<Contagem>(`/api/admin/car/importacoes/${id}/lote`, "POST", { tema, inicio: lote.inicio, feicoes: lote.feicoes });
        }
        if (!r.ok) {
          setErro({ ...r.erro, solucao: `${r.erro.solucao ?? ""} A importação ficou incompleta e não passou a valer; descarte-a no histórico e tente de novo.`.trim() });
          setFase("parado"); router.refresh();
          return;
        }
        const soma = porTema[tema] ?? { lidos: 0, gravados: 0, duplicados: 0, invalidos: 0, corrigidos: 0 };
        for (const k of Object.keys(soma) as (keyof Contagem)[]) soma[k] += r.dados[k] ?? 0;
        porTema[tema] = soma;
        feitos += lote.feicoes.length;
      }
    }

    setFase("concluindo");
    setProgresso({ feitos, total: totalFeicoes, tema: "" });
    const concluida = await enviarJson<{ status: string }>(`/api/admin/car/importacoes/${id}/concluir`, "POST");
    setFase("parado");
    if (!concluida.ok) { setErro(concluida.erro); router.refresh(); return; }
    setFim({ id, municipio: `${municipio.nome}/${municipio.uf}`, status: concluida.dados.status, porTema });
    setArquivos([]); setLido(null); setCampoArquivo((n) => n + 1);
    router.refresh();
  }

  const pct = progresso.total ? Math.round((100 * progresso.feitos) / progresso.total) : 0;

  return (
    <div className="cartao space-y-5 p-6">
      <label className="block">
        <span className={ROTULO}>Arquivo do SICAR (zip do município)</span>
        <span className="flex items-center gap-4 rounded-xl border border-dashed border-linha-forte bg-superficie-2 px-4 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
            <UploadCloud className="size-5" />
          </span>
          <input key={campoArquivo} type="file" accept=".zip" multiple disabled={ocupado}
            className="min-w-0 flex-1 text-sm text-texto-2 file:mr-3 file:rounded-lg file:border-0 file:bg-superficie file:px-3 file:py-2 file:text-sm file:font-semibold file:text-texto"
            onChange={(e) => escolher([...(e.target.files ?? [])])} />
        </span>
        <span className="mt-1.5 block text-sm text-texto-2">
          Pode soltar o zip completo do município ou os zips de cada tema juntos (APP, RESERVA_LEGAL…).
          O arquivo é lido aqui no navegador; só os polígonos vão para o servidor.
        </span>
      </label>

      {fase === "lendo" && <p className="text-sm text-texto-2">Lendo o arquivo…</p>}

      {lido && !ocupado && (
        <div className="space-y-5">
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full min-w-[520px] text-[0.95rem]">
              <thead className="bg-superficie-2 text-left text-[11px] font-semibold uppercase tracking-wider text-texto-2">
                <tr>
                  <th className="px-4 py-2.5">Camada no arquivo</th>
                  <th className="px-3 py-2.5">Tema</th>
                  <th className="px-3 py-2.5 text-right">Polígonos</th>
                  <th className="px-4 py-2.5">Projeção</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {lido.camadas.map((c) => (
                  <tr key={c.nome} className={c.tema ? "" : "text-texto-2"}>
                    <td className="px-4 py-2.5"><FileArchive className="mr-1.5 inline size-4 text-texto-2" />{c.nome.split("/").pop()}</td>
                    <td className="px-3 py-2.5">{c.tema ? TEMAS_CAR[c.tema] : "não reconhecido (ignorada)"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmt(c.feicoes.length)}
                      {c.descartadas.length > 0 && <span className="text-alerta"> · {fmt(c.descartadas.length)} descartados</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-texto-2">{c.projecao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lido.avisos.length > 0 && (
            <ul className="ml-5 list-disc space-y-0.5 text-sm text-alerta">
              {lido.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={ROTULO}>Município (código IBGE)</span>
              <input className={CAMPO} inputMode="numeric" maxLength={7} value={codIbge}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setCodIbge(v); buscarMunicipio(v); }} />
              <span className="mt-1.5 block text-sm text-texto-2">
                {municipio
                  ? <><strong className="text-texto">{municipio.nome}/{municipio.uf}</strong>
                    {lido.codIbge === municipio.cod_ibge ? " — lido do código dos imóveis do arquivo." : ""}
                    {municipio.cobertura && <> Já tem base de {new Date(`${municipio.cobertura.data_base}T12:00:00`).toLocaleDateString("pt-BR")}; os temas deste arquivo vão substituí-la (a anterior fica no histórico).</>}</>
                  : codIbge.length === 7 ? "Procurando no IBGE…" : "Não achei o município no arquivo: informe o código de 7 dígitos."}
              </span>
              {lido.outrosMunicipios > 0 && (
                <span className="mt-1 block text-sm text-texto-2">
                  {fmt(lido.outrosMunicipios)} imóvel(is) com código de outro município: é normal na divisa e eles entram junto.
                </span>
              )}
            </label>
            <label className="block">
              <span className={ROTULO}>Data em que o arquivo foi baixado do SICAR</span>
              <input type="date" className={CAMPO} value={dataBase} max={hoje()} onChange={(e) => setDataBase(e.target.value)} />
              <span className="mt-1.5 block text-sm text-texto-2">Aparece como &ldquo;base de&rdquo; no relatório e no painel de cobertura.</span>
            </label>
          </div>

          {erro?.codigo === "arquivo_repetido" && (
            <label className="flex items-center gap-2 text-sm text-texto">
              <input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} /> Importar mesmo assim
            </label>
          )}

          <button onClick={importar} disabled={!municipio || !totalFeicoes || !dataBase}
            className="btn-verde inline-flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-50">
            <UploadCloud className="size-4" />
            Importar {fmt(totalFeicoes)} polígonos{municipio ? ` de ${municipio.nome}` : ""}
          </button>
        </div>
      )}

      {(fase === "enviando" || fase === "concluindo") && (
        <div className="space-y-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-superficie-2">
            <div className="h-full bg-verde transition-all duration-200" style={{ width: `${fase === "concluindo" ? 100 : pct}%` }} />
          </div>
          <p className="text-sm tabular-nums text-texto-2">
            {fase === "concluindo"
              ? "Conferindo e passando a nova versão a valer…"
              : `Enviando ${progresso.tema}… ${fmt(progresso.feitos)} de ${fmt(progresso.total)} polígonos (${pct}%). Não feche a aba.`}
          </p>
        </div>
      )}

      {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}

      {fim && (
        <AvisoOk>
          <p className="font-semibold">
            {fim.status === "concluida" ? "Importação concluída" : fim.status === "com_falhas" ? "Importação concluída com falhas registradas" : "Nada foi gravado"}: {fim.municipio}.
          </p>
          <ul className="space-y-0.5 pt-1 text-[13px] text-texto-2">
            {Object.entries(fim.porTema).map(([t, c]) => (
              <li key={t}>
                <strong className="text-texto">{TEMAS_CAR[t as TemaCar]}</strong>: {fmt(c.gravados)} gravados
                {c.corrigidos > 0 && `, ${fmt(c.corrigidos)} com geometria corrigida`}
                {c.duplicados > 0 && `, ${fmt(c.duplicados)} repetidos ignorados`}
                {c.invalidos > 0 && <span className="text-alerta">, {fmt(c.invalidos)} recusados</span>}
              </li>
            ))}
          </ul>
          <p className="pt-1 text-[13px]"><Link className="font-semibold text-verde underline" href={`/admin/car/${fim.id}`}>Ver a ficha da importação</Link></p>
        </AvisoOk>
      )}

      {arquivos.length > 0 && !lido && !ocupado && !erro && (
        <p className="text-sm text-texto-2">{(arquivos.reduce((s, a) => s + a.size, 0) / MB).toFixed(1)} MB selecionados.</p>
      )}
    </div>
  );
}
