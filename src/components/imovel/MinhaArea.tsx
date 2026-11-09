"use client";

/**
 * Minha área (item 29): o anunciante desenha sobre a divisa do imóvel os seus
 * pontos, linhas e polígonos de trabalho (piquetes, plantio, benfeitorias,
 * projetos), dá nome e cor, vê área e comprimento e anexa arquivos de projeto.
 *
 * Mesmo jeito de desenhar do DesenhoMapa do anúncio (clique nos vértices,
 * duplo clique fecha) e mesma geodésia do turf das ferramentas de medir — mas
 * é outro componente: o desenho do anúncio não muda. Só o dono e a Central
 * veem; a Central abre em modo leitura.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MLMap, MapMouseEvent, GeoJSONSource } from "maplibre-gl";
import {
  Circle, Eraser, FileUp, Hand, Paperclip, PenLine, Pentagon, Save, Spline, Trash2, X,
} from "lucide-react";
import { ESTILO_BASE, CENTRO_REGIAO } from "@/lib/map/config";
import { carregarMaplibre } from "@/lib/map/maplibre";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import {
  CATEGORIAS_DESENHO, CATEGORIA_DESENHO_LABEL, CORES_DESENHO, formatAreaDesenho, formatComprimento, medir,
  type ArquivoArea, type CategoriaDesenho, type Desenho, type GeometriaDesenho,
} from "@/lib/imovel/minhaArea";

type Modo = "mover" | "ponto" | "linha" | "poligono";
type Rascunho = { geojson: GeometriaDesenho; nome: string; categoria: CategoriaDesenho; cor: string; notas: string };

const ACEITA_ARQ = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.dwg,.dxf,.kml,.kmz";

function enquadrar(map: MLMap, geoms: GeoJSON.Geometry[]) {
  const coords: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const g of geoms) walk((g as { coordinates?: unknown }).coordinates);
  if (!coords.length) return;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 50, duration: 0, maxZoom: 18 });
}

const tamanho = (b: number | null) => (b == null ? "" : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function MinhaArea({ propertyId, somenteLeitura = false }: { propertyId: string; somenteLeitura?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [pronto, setPronto] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [disponivel, setDisponivel] = useState(true);
  const [divisa, setDivisa] = useState<GeoJSON.Geometry | null>(null);
  const [desenhos, setDesenhos] = useState<Desenho[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoArea[]>([]);
  const [modo, setModo] = useState<Modo>("mover");
  const modoRef = useRef(modo);
  useEffect(() => { modoRef.current = modo; }, [modo]);
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const verticesRef = useRef(vertices);
  useEffect(() => { verticesRef.current = vertices; }, [vertices]);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [editando, setEditando] = useState<Desenho | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState("");

  const carregar = useCallback(async () => {
    const res = await fetch(`/api/imoveis/${propertyId}/minha-area`);
    if (!res.ok) { setMsg("Não foi possível carregar a Minha área."); setCarregado(true); return; }
    const d = await res.json();
    setDisponivel(d.disponivel !== false);
    setDivisa(d.divisa ?? null);
    setDesenhos(d.desenhos ?? []);
    setArquivos(d.arquivos ?? []);
    setCarregado(true);
  }, [propertyId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // ---------- mapa ----------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;
    (async () => {
      const maplibregl = await carregarMaplibre();
      if (cancelado || !containerRef.current) return;
      const estilo = structuredClone(ESTILO_BASE);
      estilo.layers = estilo.layers.map((l) => ({
        ...l, layout: { visibility: l.id === "base-satelite" ? "visible" : "none" },
      })) as typeof estilo.layers;
      const map = new maplibregl.Map({
        container: containerRef.current, style: estilo, center: CENTRO_REGIAO, zoom: 12,
        doubleClickZoom: false, attributionControl: { compact: true },
      });
      mapa = map;
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        const vazio: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        map.addSource("divisa", { type: "geojson", data: vazio });
        map.addLayer({ id: "divisa-linha", type: "line", source: "divisa",
          paint: { "line-color": "#F2F2EC", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
        map.addSource("desenhos", { type: "geojson", data: vazio });
        map.addLayer({ id: "desenhos-fill", type: "fill", source: "desenhos", filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": ["get", "cor"], "fill-opacity": ["case", ["get", "sel"], 0.45, 0.25] } });
        map.addLayer({ id: "desenhos-linha", type: "line", source: "desenhos",
          filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
          paint: { "line-color": ["get", "cor"], "line-width": ["case", ["get", "sel"], 4, 2.5] } });
        map.addLayer({ id: "desenhos-ponto", type: "circle", source: "desenhos", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": ["get", "cor"], "circle-radius": ["case", ["get", "sel"], 8, 6], "circle-stroke-color": "#0A2219", "circle-stroke-width": 2 } });
        map.addSource("edicao", { type: "geojson", data: vazio });
        map.addLayer({ id: "edicao-fill", type: "fill", source: "edicao", filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#D9BD6F", "fill-opacity": 0.2 } });
        map.addLayer({ id: "edicao-linha", type: "line", source: "edicao",
          filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
          paint: { "line-color": "#D9BD6F", "line-width": 2.5, "line-dasharray": [2, 1] } });
        map.addLayer({ id: "edicao-vertices", type: "circle", source: "edicao", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": "#fff", "circle-radius": 4.5, "circle-stroke-color": "#D9BD6F", "circle-stroke-width": 2 } });
        setPronto(true);
      });

      map.on("click", (e: MapMouseEvent) => {
        const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const m = modoRef.current;
        if (m === "mover") {
          const f = map.queryRenderedFeatures(e.point, { layers: ["desenhos-ponto", "desenhos-linha", "desenhos-fill"] })[0];
          setSelecionado(f ? String(f.properties?.id ?? "") || null : null);
          return;
        }
        if (m === "ponto") {
          setVertices([]);
          setRascunho((r) => ({ nome: "", categoria: "piquete", cor: CORES_DESENHO[0], notas: "", ...(r ?? {}), geojson: { type: "Point", coordinates: p } }));
          return;
        }
        setVertices([...verticesRef.current, p]);
      });

      map.on("dblclick", () => {
        const m = modoRef.current;
        // o duplo clique também dispara dois cliques no mesmo lugar: tira os repetidos
        const vs = verticesRef.current.filter((v, i, a) => i === 0 || v[0] !== a[i - 1][0] || v[1] !== a[i - 1][1]);
        if (m === "linha") {
          if (vs.length < 2) { setMsg("Uma linha precisa de pelo menos 2 pontos."); return; }
          setRascunho({ nome: "", categoria: "projeto", cor: CORES_DESENHO[0], notas: "", geojson: { type: "LineString", coordinates: vs } });
          setVertices([]);
        } else if (m === "poligono") {
          if (vs.length < 3) { setMsg("Um polígono precisa de pelo menos 3 pontos."); return; }
          setRascunho({ nome: "", categoria: "plantio", cor: CORES_DESENHO[1], notas: "", geojson: { type: "Polygon", coordinates: [[...vs, vs[0]]] } });
          setVertices([]);
        }
      });
    })();
    return () => {
      cancelado = true;
      mapa?.remove();
      mapRef.current = null;
    };
  }, []);

  // divisa + enquadramento inicial
  const enquadrou = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map || !carregado) return;
    (map.getSource("divisa") as GeoJSONSource).setData({
      type: "FeatureCollection", features: divisa ? [{ type: "Feature", geometry: divisa, properties: {} }] : [],
    });
    if (!enquadrou.current) {
      enquadrou.current = true;
      const geoms = divisa ? [divisa] : desenhos.map((d) => d.geojson);
      if (geoms.length) enquadrar(map, geoms);
    }
  }, [pronto, carregado, divisa, desenhos]);

  // desenhos salvos
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    (map.getSource("desenhos") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: desenhos.map((d) => ({ type: "Feature", geometry: d.geojson, properties: { id: d.id, cor: d.cor, sel: d.id === selecionado } })),
    });
  }, [pronto, desenhos, selecionado]);

  // desenho em andamento
  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    const features: GeoJSON.Feature[] = [];
    if (rascunho) features.push({ type: "Feature", geometry: rascunho.geojson, properties: {} });
    if (vertices.length) {
      if (vertices.length > 1) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: modo === "poligono" && vertices.length > 2 ? [...vertices, vertices[0]] : vertices }, properties: {} });
      for (const v of vertices) features.push({ type: "Feature", geometry: { type: "Point", coordinates: v }, properties: {} });
    }
    (map.getSource("edicao") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [pronto, vertices, rascunho, modo]);

  function trocarModo(m: Modo) {
    setModo(m);
    setVertices([]);
    setRascunho(null);
    setMsg("");
  }

  // medida ao vivo enquanto desenha
  const medidaAoVivo = (() => {
    if (modo === "linha" && vertices.length >= 2) return `Comprimento: ${formatComprimento(medir({ type: "LineString", coordinates: vertices }).comprimento_m)}`;
    if (modo === "poligono" && vertices.length >= 3) {
      const m = medir({ type: "Polygon", coordinates: [[...vertices, vertices[0]]] });
      return `Área: ${formatAreaDesenho(m.area_m2)} · perímetro ${formatComprimento(m.comprimento_m)}`;
    }
    return "";
  })();
  const medidaRascunho = rascunho ? medir(rascunho.geojson) : null;

  async function salvarRascunho(e: React.FormEvent) {
    e.preventDefault();
    if (!rascunho) return;
    setOcupado(true);
    const r = await enviarJson<{ desenho: Desenho }>(`/api/imoveis/${propertyId}/minha-area`, "POST", rascunho);
    setOcupado(false);
    if (!r.ok) { setMsg(r.erro.mensagem); return; }
    setDesenhos((ds) => [...ds, r.dados.desenho]);
    setSelecionado(r.dados.desenho.id);
    setRascunho(null);
    setMsg(`"${r.dados.desenho.nome}" salvo.`);
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setOcupado(true);
    const { id, nome, categoria, cor, notas } = editando;
    const r = await enviarJson<{ desenho: Desenho }>(`/api/imoveis/${propertyId}/minha-area`, "PATCH", { id, nome, categoria, cor, notas: notas ?? "" });
    setOcupado(false);
    if (!r.ok) { setMsg(r.erro.mensagem); return; }
    setDesenhos((ds) => ds.map((d) => (d.id === id ? r.dados.desenho : d)));
    setEditando(null);
  }

  async function apagar(d: Desenho) {
    if (!confirm(`Apagar "${d.nome}"? Os arquivos anexados continuam no imóvel.`)) return;
    const r = await enviarJson(`/api/imoveis/${propertyId}/minha-area?desenho=${d.id}`, "DELETE");
    if (!r.ok) { setMsg(r.erro.mensagem); return; }
    setDesenhos((ds) => ds.filter((x) => x.id !== d.id));
    setArquivos((as) => as.map((a) => (a.desenho_id === d.id ? { ...a, desenho_id: null } : a)));
    if (selecionado === d.id) setSelecionado(null);
  }

  async function anexar(f: File, desenhoId: string | null) {
    setOcupado(true);
    setMsg("Enviando arquivo…");
    const fd = new FormData();
    fd.set("arquivo", f);
    if (desenhoId) fd.set("desenho_id", desenhoId);
    const res = await fetch(`/api/imoveis/${propertyId}/minha-area/arquivos`, { method: "POST", body: fd });
    const corpo = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setMsg(corpo.error ? `${corpo.error}${corpo.solucao ? ` ${corpo.solucao}` : ""}` : "Falha no envio do arquivo."); return; }
    setArquivos((as) => [...as, corpo.arquivo]);
    setMsg(`${f.name} anexado.`);
  }

  async function removerArquivo(a: ArquivoArea) {
    if (!confirm(`Apagar o arquivo ${a.nome_arquivo}?`)) return;
    const r = await enviarJson(`/api/imoveis/${propertyId}/minha-area/arquivos?arquivo=${a.id}`, "DELETE");
    if (!r.ok) { setMsg(r.erro.mensagem); return; }
    setArquivos((as) => as.filter((x) => x.id !== a.id));
  }

  const listaArquivos = (lista: ArquivoArea[]) => (
    <ul className="mt-2 space-y-1.5">
      {lista.map((a) => (
        <li key={a.id} className="flex items-center gap-2 text-sm">
          <Paperclip className="size-3.5 shrink-0 text-texto-2" />
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-semibold text-verde hover:underline">{a.nome_arquivo}</a>
          <span className="shrink-0 text-xs text-texto-2">{tamanho(a.tamanho_bytes)}</span>
          {!somenteLeitura && (
            <button type="button" onClick={() => removerArquivo(a)} aria-label={`Apagar ${a.nome_arquivo}`} className="ml-auto shrink-0 text-texto-2 hover:text-critico">
              <X className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  const botaoAnexar = (desenhoId: string | null, rotulo: string) => somenteLeitura ? null : (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold ${ocupado ? "text-texto-2" : "text-verde hover:underline"}`}>
      <FileUp className="size-4" /> {rotulo}
      <input type="file" className="hidden" accept={ACEITA_ARQ} disabled={ocupado}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void anexar(f, desenhoId); }} />
    </label>
  );

  if (carregado && !disponivel) {
    return <p className="cartao p-6 text-base text-texto-2">A Minha área estará disponível em breve.</p>;
  }

  const ferramentas: { m: Modo; rotulo: string; icone: typeof Hand }[] = [
    { m: "mover", rotulo: "Navegar", icone: Hand },
    { m: "ponto", rotulo: "Ponto", icone: Circle },
    { m: "linha", rotulo: "Linha", icone: Spline },
    { m: "poligono", rotulo: "Polígono", icone: Pentagon },
  ];
  const doImovel = arquivos.filter((a) => !a.desenho_id);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        {!somenteLeitura && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {ferramentas.map(({ m, rotulo, icone: Icone }) => (
              <button key={m} type="button" onClick={() => trocarModo(m)} aria-pressed={modo === m}
                className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 font-semibold transition ${modo === m ? "border-verde bg-verde text-fundo" : "border-linha-forte text-texto-3 hover:border-verde hover:text-verde"}`}>
                <Icone className="size-4" /> {rotulo}
              </button>
            ))}
            {(vertices.length > 0 || rascunho) && (
              <button type="button" onClick={() => { setVertices([]); setRascunho(null); }} className="btn-contorno inline-flex items-center gap-1.5 px-3.5 py-2">
                <Eraser className="size-4" /> Descartar
              </button>
            )}
          </div>
        )}
        <div ref={containerRef} className="h-[28rem] w-full overflow-hidden rounded-2xl border border-linha md:h-[34rem]" />
        <p className="min-h-5 text-sm leading-relaxed text-texto-2">
          {medidaAoVivo || msg || (!pronto ? "Carregando mapa…"
            : somenteLeitura ? "Visualização da Central: só o dono do imóvel desenha e anexa."
            : modo === "ponto" ? "Clique no mapa para marcar o ponto (piquete, poço, porteira…)."
            : modo === "linha" ? "Clique nos vértices; duplo clique termina a linha (cerca, estrada, rede)."
            : modo === "poligono" ? "Clique nos vértices; duplo clique fecha a área (plantio, piquete, construção)."
            : "A linha tracejada clara é a divisa do imóvel. Escolha Ponto, Linha ou Polígono para desenhar.")}
        </p>

        {rascunho && !somenteLeitura && (
          <form onSubmit={salvarRascunho} className="cartao space-y-4 p-5">
            <p className="font-semibold text-texto">
              Novo {rascunho.geojson.type === "Point" ? "ponto" : rascunho.geojson.type === "LineString" ? "traçado" : "polígono"}
              {medidaRascunho?.area_m2 != null && <> · {formatAreaDesenho(medidaRascunho.area_m2)}</>}
              {medidaRascunho?.comprimento_m != null && <> · {formatComprimento(medidaRascunho.comprimento_m)}</>}
            </p>
            <CamposDesenho valor={rascunho} onChange={(v) => setRascunho({ ...rascunho, ...v })} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={ocupado} className="btn-verde inline-flex items-center gap-2 px-5 py-2.5 text-sm disabled:opacity-50">
                <Save className="size-4" /> {ocupado ? "Salvando…" : "Salvar desenho"}
              </button>
              <button type="button" onClick={() => setRascunho(null)} className="btn-contorno px-5 py-2.5 text-sm">Descartar</button>
            </div>
          </form>
        )}
      </div>

      <aside className="space-y-5">
        <section>
          <h3 className="lp-display text-lg text-texto">Desenhos ({desenhos.length})</h3>
          {desenhos.length === 0 ? (
            <p className="mt-2 text-sm text-texto-2">{somenteLeitura ? "Nenhum desenho." : "Nenhum desenho ainda. Use as ferramentas acima do mapa."}</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {desenhos.map((d) => {
                const anexos = arquivos.filter((a) => a.desenho_id === d.id);
                const ativo = d.id === selecionado;
                if (editando?.id === d.id) {
                  return (
                    <li key={d.id} className="cartao p-4">
                      <form onSubmit={salvarEdicao} className="space-y-3">
                        <CamposDesenho valor={{ ...editando, notas: editando.notas ?? "" }} onChange={(v) => setEditando({ ...editando, ...v })} />
                        <div className="flex gap-2">
                          <button type="submit" disabled={ocupado} className="btn-verde px-4 py-2 text-sm disabled:opacity-50">Salvar</button>
                          <button type="button" onClick={() => setEditando(null)} className="btn-contorno px-4 py-2 text-sm">Voltar</button>
                        </div>
                      </form>
                    </li>
                  );
                }
                return (
                  <li key={d.id} className={`cartao p-4 transition-colors ${ativo ? "!border-ouro" : ""}`}>
                    <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => {
                      setSelecionado(d.id);
                      if (mapRef.current) enquadrar(mapRef.current, [d.geojson]);
                    }}>
                      <span className="mt-1 size-3.5 shrink-0 rounded-full border border-linha-forte" style={{ background: d.cor }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-texto">{d.nome}</span>
                        <span className="block text-sm text-texto-2">
                          {CATEGORIA_DESENHO_LABEL[d.categoria] ?? d.categoria}
                          {d.area_m2 != null && <> · {formatAreaDesenho(Number(d.area_m2))}</>}
                          {d.comprimento_m != null && <> · {d.geojson.type === "Polygon" ? "perímetro " : ""}{formatComprimento(Number(d.comprimento_m))}</>}
                        </span>
                        {d.notas && <span className="mt-1 block text-sm text-texto-3">{d.notas}</span>}
                      </span>
                    </button>
                    {anexos.length > 0 && listaArquivos(anexos)}
                    {!somenteLeitura && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        {botaoAnexar(d.id, "Anexar")}
                        <button type="button" onClick={() => setEditando(d)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-texto">
                          <PenLine className="size-4" /> Editar
                        </button>
                        <button type="button" onClick={() => apagar(d)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-critico">
                          <Trash2 className="size-4" /> Apagar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="cartao p-4">
          <h3 className="font-semibold text-texto">Arquivos do imóvel</h3>
          <p className="mt-1 text-sm text-texto-2">Projetos que valem para o imóvel todo. PDF, imagem, DWG, DXF, KML ou KMZ, até 25 MB.</p>
          {doImovel.length > 0 && listaArquivos(doImovel)}
          <div className="mt-3">{botaoAnexar(null, "Anexar ao imóvel")}</div>
        </section>
      </aside>
    </div>
  );
}

/** Nome, categoria, cor e notas de um desenho. */
function CamposDesenho({ valor, onChange }: {
  valor: { nome: string; categoria: CategoriaDesenho; cor: string; notas: string };
  onChange: (v: Partial<{ nome: string; categoria: CategoriaDesenho; cor: string; notas: string }>) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={ROTULO}>Nome</span>
          <input className={CAMPO} required maxLength={120} value={valor.nome} placeholder="Ex.: Piquete 3"
            onChange={(e) => onChange({ nome: e.target.value })} />
        </label>
        <label className="block">
          <span className={ROTULO}>Tipo</span>
          <select className={CAMPO} value={valor.categoria} onChange={(e) => onChange({ categoria: e.target.value as CategoriaDesenho })}>
            {CATEGORIAS_DESENHO.map((c) => <option key={c} value={c}>{CATEGORIA_DESENHO_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className={ROTULO}>Cor</legend>
        <div className="flex flex-wrap gap-2">
          {CORES_DESENHO.map((c) => (
            <button key={c} type="button" onClick={() => onChange({ cor: c })} aria-label={`Cor ${c}`} aria-pressed={valor.cor.toUpperCase() === c}
              className={`size-8 rounded-full border-2 transition ${valor.cor.toUpperCase() === c ? "border-texto scale-110" : "border-linha-forte"}`}
              style={{ background: c }} />
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className={ROTULO}>Notas (opcional)</span>
        <textarea className={CAMPO} rows={2} maxLength={2000} value={valor.notas} onChange={(e) => onChange({ notas: e.target.value })} />
      </label>
    </>
  );
}
