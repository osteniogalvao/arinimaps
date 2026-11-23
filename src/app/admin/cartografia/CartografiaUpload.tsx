"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { enviarArquivo, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro, AvisoOk } from "@/components/ui/Aviso";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { UploadCloud } from "lucide-react";

type Resposta = {
  mensagem?: string;
  tipo?: string;
  linhas?: number;
  layers_cad?: number;
  zona?: number | string;
  municipio?: string | null;
  distancia_municipio_km?: number | null;
  dentro_do_municipio?: boolean | null;
  bytes?: number;
  avisos?: string[];
  diagnostico?: {
    segundos: number;
    entidadesLidas: number;
    ignoradasSemGeometria: number;
    blocosExpandidos: number;
    pontosDescartados: number;
    layers: { nome: string; linhas: number }[];
    geometriasPorTipo: Record<string, number>;
  };
};

const MB = 1024 * 1024;
const fmt = (n: number) => n.toLocaleString("pt-BR");

type Municipio = { id: string; nome: string; codigo_ibge?: string | null };

/**
 * Distritos do município pela API de localidades do IBGE (áudio do Carlos,
 * 18/11: "Carneirinho tem seis distritos, como Fátima"). O distrito-sede, que
 * tem o mesmo nome do município, é a sede: fica de fora da lista.
 */
function useDistritos(m: Municipio | undefined) {
  const [lista, setLista] = useState<string[]>([]);
  useEffect(() => {
    const cod = m?.codigo_ibge;
    if (!cod || !/^\d{7}$/.test(cod)) return;
    let vivo = true;
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${cod}/distritos`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: { nome: string }[]) => {
        if (vivo) setLista(d.map((x) => x.nome).filter((n) => n.localeCompare(m.nome, "pt-BR", { sensitivity: "base" }) !== 0).sort((a, b) => a.localeCompare(b, "pt-BR")));
      })
      .catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; setLista([]); };
  }, [m]);
  return lista;
}

export default function CartografiaUpload({ municipios }: { municipios: Municipio[] }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [distrito, setDistrito] = useState("");
  const distritos = useDistritos(municipios.find((m) => m.id === municipio));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [fase, setFase] = useState<"parado" | "enviando" | "convertendo">("parado");
  const [pct, setPct] = useState(0);
  const [ok, setOk] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);

  const ocupado = fase !== "parado";
  const grande = arquivo && arquivo.size > 50 * MB;

  async function publicar() {
    if (!arquivo) return;
    setErro(null); setOk(null); setPct(0); setFase("enviando");

    const r = await enviarArquivo<Resposta>("/api/admin/cartografia", arquivo, {
      nome, municipality_id: municipio, ...(distrito.trim() ? { distrito: distrito.trim() } : {}),
    }, (p) => {
      setPct(p);
      if (p >= 100) setFase("convertendo");
    });

    setFase("parado");
    if (r.ok) {
      setOk(r.dados);
      setNome(""); setArquivo(null);
      router.refresh();
    } else {
      setErro(r.erro);
    }
  }

  return (
    <div className="cartao p-6 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={ROTULO}>Nome da camada</span>
          <input className={CAMPO} placeholder="Ex.: Planta urbana — Iturama"
            value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="block">
          <span className={ROTULO}>Município</span>
          <select className={CAMPO} value={municipio} onChange={(e) => { setMunicipio(e.target.value); setDistrito(""); }}>
            <option value="">Município…</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={ROTULO}>Distrito <span className="font-normal text-texto-2">(deixe em branco se for a sede da cidade)</span></span>
          <input className={CAMPO} list="distritos-ibge" disabled={!municipio} maxLength={80}
            placeholder={distritos.length ? `Ex.: ${distritos[0]}` : "Digite o nome do distrito"}
            value={distrito} onChange={(e) => setDistrito(e.target.value)} />
          <datalist id="distritos-ibge">{distritos.map((d) => <option key={d} value={d} />)}</datalist>
          {municipio && distritos.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {["", ...distritos].map((d) => (
                <button key={d || "sede"} type="button" onClick={() => setDistrito(d)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${distrito === d ? "border-verde bg-verde/12 font-semibold text-texto" : "border-linha text-texto-2"}`}>
                  {d || "Sede"}
                </button>
              ))}
            </span>
          )}
          <span className="mt-1 block text-xs text-texto-2">Cada distrito tem a sua planta. Enviar a planta de um distrito não mexe na da sede.</span>
        </label>
      </div>

      <label className="block">
        <span className={ROTULO}>Arquivo da planta</span>
        <span className="flex items-center gap-4 rounded-xl border border-dashed border-linha-forte bg-superficie-2 px-4 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
            <UploadCloud className="size-5" />
          </span>
          <input type="file" accept=".dxf,.tif,.tiff,.png,.jpg,.jpeg"
            className="min-w-0 flex-1 text-sm text-texto-2 file:mr-3 file:rounded-lg file:border-0 file:bg-superficie file:px-3 file:py-2 file:text-sm file:font-semibold file:text-texto"
            disabled={ocupado}
            onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setErro(null); setOk(null); }} />
        </span>
      </label>

      <p className="text-sm text-texto-2">
        DXF (planta CAD) publica na hora · GeoTIFF/PNG/JPG georreferenciado vira tiles pelo worker.
        {arquivo && <> · <strong className="text-texto">{(arquivo.size / MB).toFixed(1)} MB</strong> selecionados</>}
      </p>

      {grande && !ocupado && (
        <p className="text-sm text-alerta">
          Arquivo grande: o envio leva alguns minutos e a conversão mais alguns segundos.
          Não feche a aba — a barra abaixo mostra o andamento real.
        </p>
      )}

      {ocupado && (
        <div className="space-y-1.5">
          <div className="h-2 rounded-full bg-superficie-2 overflow-hidden">
            <div
              className="h-full bg-verde transition-all duration-200"
              style={{ width: fase === "convertendo" ? "100%" : `${pct}%` }}
            />
          </div>
          <p className="text-sm text-texto-2 tabular-nums">
            {fase === "enviando"
              ? `Enviando… ${pct}%${arquivo ? ` de ${(arquivo.size / MB).toFixed(1)} MB` : ""}`
              : "Convertendo a planta no servidor — lendo entidades do CAD e projetando para o mapa."}
          </p>
        </div>
      )}

      {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}

      {ok && (
        <AvisoOk>
          <p className="font-semibold">{ok.mensagem}</p>
          {ok.tipo === "vetorial" && (
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-texto-2 text-[13px] pt-1">
              <p>Linhas no mapa: <strong className="text-texto">{fmt(ok.linhas ?? 0)}</strong></p>
              <p>Camadas do CAD: <strong className="text-texto">{ok.layers_cad}</strong></p>
              <p>Sistema lido: <strong className="text-texto">{ok.zona === "graus" ? "graus (WGS84)" : `UTM ${ok.zona}S`}</strong></p>
              <p>Peso da planta: <strong className="text-texto">{((ok.bytes ?? 0) / MB).toFixed(1)} MB</strong></p>
              {ok.dentro_do_municipio != null && (
                <p className="sm:col-span-2">
                  {ok.dentro_do_municipio
                    ? <>Enquadramento: a planta <strong className="text-texto">cai dentro de {ok.municipio}</strong>.</>
                    : <>Enquadramento: a planta fica a <strong className="text-texto">{ok.distancia_municipio_km} km</strong> de {ok.municipio}.</>}
                </p>
              )}
              {ok.diagnostico && (
                <p className="sm:col-span-2">
                  {fmt(ok.diagnostico.entidadesLidas)} entidades lidas em {ok.diagnostico.segundos}s ·{" "}
                  {fmt(ok.diagnostico.ignoradasSemGeometria)} de texto/cota ignoradas ·{" "}
                  {fmt(ok.diagnostico.blocosExpandidos)} blocos desenhados ·{" "}
                  {fmt(ok.diagnostico.pontosDescartados)} pontos fora da região descartados
                </p>
              )}
            </div>
          )}
          {!!ok.avisos?.length && (
            <ul className="list-disc ml-5 pt-1 space-y-0.5 text-alerta text-[13px]">
              {ok.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          {!!ok.diagnostico?.layers?.length && (
            <p className="text-[13px] text-texto-2 pt-1">
              Camadas mais pesadas: {ok.diagnostico.layers.slice(0, 5).map((l) => `${l.nome} (${fmt(l.linhas)})`).join(" · ")}.
              {" "}Use <strong className="text-texto">Calibrar sobre o satélite</strong> para esconder as que não são cadastro.
            </p>
          )}
        </AvisoOk>
      )}

      <button disabled={ocupado || !nome || !municipio || !arquivo}
        className="btn-ouro inline-flex items-center gap-2 px-6 py-3 disabled:opacity-50"
        onClick={publicar}>
        <UploadCloud className="size-4" />
        {fase === "enviando" ? `Enviando ${pct}%…` : fase === "convertendo" ? "Convertendo…" : "Publicar camada"}
      </button>
    </div>
  );
}
