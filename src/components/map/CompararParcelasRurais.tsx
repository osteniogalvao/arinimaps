"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";

type Municipio = { cod:number; nome:string; uf:string };
type Parcela = {
  id:string; nome:string; matricula:string | null; areaHa:number; geometria:GeoJSON.Polygon | GeoJSON.MultiPolygon;
};
const CORES = ["#21b4ba", "#ebae43", "#b89df1"];
const fonte = "parcelas-comparadas";
const area = (n:number) => n.toLocaleString("pt-BR", { maximumFractionDigits:2 }) + " ha";

function mostrarParcelas(mapa: MLMap, parcelas: Parcela[]) {
  const dados: GeoJSON.FeatureCollection = { type:"FeatureCollection", features:parcelas.map((p,i) => ({
    type:"Feature", geometry:p.geometria, properties:{ cor:CORES[i] },
  })) };
  const origem = mapa.getSource(fonte) as GeoJSONSource | undefined;
  if (origem) origem.setData(dados);
  else if (parcelas.length) {
    mapa.addSource(fonte,{ type:"geojson", data:dados });
    mapa.addLayer({ id:fonte+"-area", type:"fill", source:fonte, paint:{ "fill-color":["get","cor"], "fill-opacity":.24 } });
    mapa.addLayer({ id:fonte+"-linha", type:"line", source:fonte, paint:{ "line-color":["get","cor"], "line-width":3 } });
  }
  if (!parcelas.length) return;
  let oeste=180, sul=90, leste=-180, norte=-90;
  for (const p of parcelas) {
    const aneis = p.geometria.type === "Polygon" ? p.geometria.coordinates : p.geometria.coordinates.flat();
    for (const anel of aneis) for (const [x,y] of anel) {
      oeste=Math.min(oeste,x); sul=Math.min(sul,y); leste=Math.max(leste,x); norte=Math.max(norte,y);
    }
  }
  if (oeste <= leste) mapa.fitBounds([[oeste,sul],[leste,norte]],{ padding:48, maxZoom:17, duration:650 });
}

export default function CompararParcelasRurais({ mapa, termo, municipios, botao, verMapa }: {
  mapa:MLMap | null; termo:string; municipios:Municipio[]; botao:RefObject<HTMLButtonElement | null>; verMapa:() => void;
}) {
  const [local, setLocal] = useState<Municipio | null>(null);
  const [filtro, setFiltro] = useState("");
  const [achados, setAchados] = useState<Parcela[]>([]);
  const [selecionados, setSelecionados] = useState<Parcela[]>([]);
  const [consulta, setConsulta] = useState("");
  const [aviso, setAviso] = useState("");
  const [carregando, setCarregando] = useState(false);
  const requisicao = useRef<AbortController | null>(null);
  useEffect(() => () => { requisicao.current?.abort(); }, []);
  useEffect(() => {
    if (mapa) mostrarParcelas(mapa, selecionados);
  }, [mapa, selecionados]);

  async function buscar(municipio:Municipio | null, nome:string) {
    if (!mapa) return;
    requisicao.current?.abort();
    const controle = new AbortController();
    requisicao.current = controle;
    setAchados([]); setCarregando(true); setAviso("");
    const b = mapa.getBounds(), params = new URLSearchParams({ nome:nome.trim() });
    if (municipio) params.set("municipio",String(municipio.cod));
    else params.set("bbox",[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(","));
    try {
      const r = await fetch("/api/geo/sigef/comparar?"+params, { signal:controle.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "A consulta não respondeu.");
      setAchados(j.parcelas); setConsulta(nome.trim());
      setAviso(j.mais ? "Exibindo 15 parcelas. Refine pelo nome para localizar outras." :
        j.parcelas.length ? "Selecione até três parcelas para comparar no mapa." : "Nenhuma parcela certificada encontrada para esta busca.");
    } catch (e) {
      if (!controle.signal.aborted) setAviso(e instanceof Error ? e.message : "Não foi possível consultar o SIGEF.");
    } finally { if (!controle.signal.aborted) setCarregando(false); }
  }

  function alternar(p:Parcela) {
    setSelecionados(atuais => atuais.some(a=>a.id===p.id) ? atuais.filter(a=>a.id!==p.id) :
      atuais.length < CORES.length ? [...atuais,p] : atuais);
  }
  const btn = "btn-contorno w-full px-3 py-2 text-sm";
  return <div className="space-y-2 text-sm">
    {!local && termo.length>=3 && <button ref={botao} type="button" className={btn} disabled={!mapa || carregando}
      onClick={()=>void buscar(null,termo)}>Buscar imóvel rural pelo nome nesta área</button>}
    {municipios.map(m=><button key={m.cod} type="button" className={btn} disabled={!mapa}
      onClick={()=>{ setLocal(m); setFiltro(""); setSelecionados([]); void buscar(m,""); }}>
      Comparar parcelas em {m.nome} · {m.uf}
    </button>)}
    {local && <div className="space-y-2">
      <p className="font-semibold">{local.nome} · {local.uf}</p>
      <form onSubmit={e=>{e.preventDefault(); void buscar(local,filtro);}} className="flex gap-1">
        <input className="min-w-0 flex-1 rounded-lg border border-linha px-2 py-1.5" aria-label="Nome da área rural no município"
          placeholder="Nome da área rural" maxLength={80} value={filtro} onChange={e=>setFiltro(e.target.value)} />
        <button type="submit" className="btn-contorno px-2" disabled={carregando || (!!filtro.trim() && filtro.trim().length<3)}>Buscar</button>
      </form>
    </div>}
    {(aviso || carregando) && <p role="status" className="text-xs text-texto-2">{carregando ? "Consultando INCRA / SIGEF…" : aviso}</p>}
    {!!achados.length && !!consulta && <p className="text-xs font-semibold">Resultados para “{consulta}”</p>}
    {!!achados.length && <ul className="max-h-40 overflow-auto divide-y divide-linha">{achados.map(p=>{
      const marcada=selecionados.some(s=>s.id===p.id);
      return <li key={p.id}><label className="flex items-start gap-2 py-2">
        <input type="checkbox" checked={marcada} disabled={!marcada && selecionados.length===CORES.length} onChange={()=>alternar(p)} />
        <span>{p.nome}<small className="block text-texto-2">Matrícula {p.matricula || "indisponível"} · {area(p.areaHa)}</small></span>
      </label></li>;
    })}</ul>}
    {!!selecionados.length && <ol className="space-y-2">{selecionados.map((p,i)=><li key={p.id} className="border-l-4 pl-2" style={{borderColor:CORES[i]}}>
      <strong>{p.nome}</strong><div className="text-xs">Área do contorno {area(p.areaHa)} · Matrícula {p.matricula || "indisponível"}</div>
      <button type="button" className="text-xs underline" onClick={()=>alternar(p)}>Retirar da comparação</button>
    </li>)}</ol>}
    {!!selecionados.length && <button type="button" className={btn} onClick={() => {
      if (mapa) mostrarParcelas(mapa, selecionados);
      verMapa();
    }}>Ver seleção no mapa</button>}
    {(local || !!achados.length || !!selecionados.length || !!aviso || carregando) && <div className="flex items-center justify-between text-xs text-texto-2">
      <span>Fonte: INCRA / SIGEF</span>
      <button type="button" className="underline" onClick={()=>{requisicao.current?.abort(); setLocal(null); setCarregando(false);
        setSelecionados([]); setAchados([]); setAviso("");}}>Encerrar comparação</button>
    </div>}
  </div>;
}
