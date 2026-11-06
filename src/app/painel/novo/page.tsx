"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { lerCarPendente, limparCarPendente } from "@/lib/map/carPendente";
import type { GeometriaEscolhida } from "@/components/map/DesenhoMapa";
import { ehEquipe as papelEhEquipe, ehParceiro as papelEhParceiro } from "@/lib/perfis";
import { enviarVideo, VIDEO_ACEITA, VIDEO_MAX_MB } from "@/lib/midia/enviarVideo";
import { comprimirFotos } from "@/lib/midia/comprimirFoto";
import {
  Check, CheckCircle2, Gavel, FileText, MapPin, Trees, LandPlot, Image as ImageIcon, ShieldCheck,
  Handshake, Camera, AlertTriangle, Send, type LucideIcon,
} from "lucide-react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";

const DesenhoMapa = dynamic(() => import("@/components/map/DesenhoMapa"), { ssr: false });

type Municipio = { id: string; nome: string };
type Condicao = "autorizacao" | "exclusividade" | "parceiro";

const ACEITA_DOC = ".pdf,.jpg,.jpeg,.png,.webp,.heic";
const MAX_DOC = 25 * 1024 * 1024;

type Docs = { matricula: File[]; edital: File[]; ccir_itr: File[]; autorizacao: File[]; outro: File[] };
type LoteDoLoteamento = {
  id: string; area_m2: number; quadra: string | null; numero: string | null;
  municipio: string | null; municipality_id: string | null; anuncio: string | null;
  /** vazio = usa o preço padrão por lote */
  valor: string;
  matricula: string;
};

const reais = (v: string) => (v ? Number(v.replace(/\./g, "").replace(",", ".")) : null);

const LEILAO_VAZIO = {
  praca1_data: "", praca1_lance: "", praca2_data: "", praca2_lance: "",
  processo: "", comitente: "", site: "", condicoes: "",
};

export default function NovoImovel() {
  const router = useRouter();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [geometria, setGeometria] = useState<GeometriaEscolhida | null>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({
    tipo: "rural", titulo: "", descricao: "", valor: "", area_declarada: "",
    municipality_id: "", condicoes_venda: "", parent_codigo: "",
    aceita_permuta: false, aceita_financiamento: false,
    matricula_numero: "", matricula_cartorio: "",
    medidas: "",
  });
  const [papel, setPapel] = useState<string | null>(null);
  // revisão do Carlos (29/10): venda pela plataforma só com exclusividade Arini
  const [condicao, setCondicao] = useState<Condicao>("exclusividade");
  const [docs, setDocs] = useState<Docs>({ matricula: [], edital: [], ccir_itr: [], autorizacao: [], outro: [] });
  const [videos, setVideos] = useState<File[]>([]);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [leilao, setLeilao] = useState(LEILAO_VAZIO);
  const [modalidade, setModalidade] = useState<"venda" | "leilao">("venda");
  const [progresso, setProgresso] = useState("");
  const [car, setCar] = useState<{ cod: string; area_ha: number | null; municipio: string | null } | null>(null);
  const [inicial, setInicial] = useState<GeometriaEscolhida | null>(null);
  const [lote, setLote] = useState<{ id: string; area_m2: number; municipio: string | null } | null>(null);
  // vários lotes selecionados no mapa: vira empreendimento + uma unidade por lote
  const [loteamento, setLoteamento] = useState<LoteDoLoteamento[] | null>(null);

  // veio de "Selecionar vários lotes" no mapa
  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get("lotes");
    if (!ids) return;
    fetch(`/api/geo/lotes?ids=${encodeURIComponent(ids)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        const feats = (fc?.features ?? []) as { geometry: GeoJSON.Polygon; properties: Omit<LoteDoLoteamento, "valor" | "matricula"> }[];
        if (!feats.length) return;
        const g: GeometriaEscolhida = {
          geometry: { type: "MultiPolygon", coordinates: feats.map((f) => f.geometry.coordinates) },
          fonte: "lote",
        };
        setLoteamento(feats.map((f) => ({ ...f.properties, area_m2: Number(f.properties.area_m2), valor: "", matricula: "" })));
        setInicial(g);
        setGeometria(g);
        setForm((atual) => ({
          ...atual,
          tipo: "urbano",
          municipality_id: atual.municipality_id || feats[0].properties.municipality_id || "",
          area_declarada: String(Math.round(feats.reduce((s, f) => s + Number(f.properties.area_m2), 0))),
        }));
      })
      .catch(() => undefined);
  }, []);

  // divisa do lote urbano (de "Este lote é meu" no mapa ou do clique na etapa de localização)
  function carregarLote(id: string) {
    fetch(`/api/geo/lotes/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => {
        if (!f?.geometry) return;
        const g: GeometriaEscolhida = { geometry: f.geometry, fonte: "lote" };
        const p = f.properties ?? {};
        setLote({ id: p.id, area_m2: Number(p.area_m2), municipio: p.municipio ?? null });
        setCar(null);
        setInicial(g);
        setGeometria(g);
        setForm((atual) => ({
          ...atual,
          tipo: "urbano",
          municipality_id: atual.municipality_id || p.municipality_id || "",
          area_declarada: atual.area_declarada || String(Math.round(Number(p.area_m2))),
        }));
      })
      .catch(() => undefined);
  }

  // divisa do CAR (de "Esta área é minha" no mapa ou do clique na etapa de localização)
  function carregarCar(cod: string) {
    fetch(`/api/geo/car/${encodeURIComponent(cod)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => {
        if (!f?.geometry) return;
        const g: GeometriaEscolhida = { geometry: f.geometry, fonte: "car" };
        const p = f.properties ?? {};
        setCar({ cod: p.cod, area_ha: p.area_ha ?? null, municipio: p.municipio ?? null });
        setLote(null);
        setInicial(g);
        setGeometria(g);
        setForm((atual) => ({
          ...atual,
          tipo: "rural",
          area_declarada: atual.area_declarada || (p.area_ha ? String(Math.round(Number(p.area_ha) * 100) / 100).replace(".", ",") : ""),
        }));
      })
      .catch(() => undefined);
  }

  // veio do mapa com o lote ou a área do CAR já escolhidos
  useEffect(() => {
    const busca = new URLSearchParams(window.location.search);
    const id = busca.get("lote");
    if (id) carregarLote(id);
    const cod = busca.get("car") || lerCarPendente();
    limparCarPendente();
    if (cod) carregarCar(cod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [aceite, setAceite] = useState(false);
  const ehParceiro = papelEhParceiro(papel);
  const ehEquipe = papelEhEquipe(papel);
  const ehLeiloeiro = papel === "leiloeiro";
  const emLeilao = modalidade === "leilao";
  // selfie só no aceite eletrônico de exclusividade (a equipe anexa contrato assinado)
  const pedeSelfie = condicao === "exclusividade" && !ehEquipe;

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("role").eq("user_id", user.id).single();
      setPapel(data?.role ?? null);
      if (papelEhParceiro(data?.role)) setCondicao("parceiro");
      if (data?.role === "leiloeiro") setModalidade("leilao");
    });
  }, []);

  useEffect(() => {
    fetch("/api/geo/municipios")
      .then((r) => r.json())
      .then((fc) =>
        setMunicipios(
          (fc.features ?? [])
            .map((f: { properties: Municipio }) => f.properties)
            .sort((a: Municipio, b: Municipio) => a.nome.localeCompare(b.nome))
        )
      )
      .catch(() => undefined);
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!geometria) {
      setErro("Marque a localização do imóvel no mapa (desenho, ponto ou KML).");
      return;
    }
    if (!ehEquipe && emLeilao && !docs.edital.length) {
      setErro("Envie o edital do leilão — é o documento que a Arini confere para publicar.");
      return;
    }
    if (!ehEquipe && !emLeilao && !docs.matricula.length) {
      setErro("Envie a matrícula do imóvel (ou escritura/contrato registrado) — é o que comprova a propriedade.");
      return;
    }
    if (ehParceiro && !emLeilao && !docs.autorizacao.length) {
      setErro("Envie a autorização de venda assinada pelo proprietário.");
      return;
    }
    if (emLeilao && !leilao.praca1_data) {
      setErro("Informe a data da 1ª praça do leilão.");
      return;
    }
    if (pedeSelfie && !selfie) {
      setErro("Para a exclusividade, tire uma selfie: ela identifica quem está aceitando o termo.");
      return;
    }
    const videoGrande = videos.find((v) => v.size > VIDEO_MAX_MB * 1024 * 1024);
    if (videoGrande) {
      setErro(`O vídeo ${videoGrande.name} passa de ${VIDEO_MAX_MB} MB. Corte ou grave em 1080p.`);
      return;
    }
    const grande = Object.values(docs).flat().find((f) => f.size > MAX_DOC);
    if (grande) {
      setErro(`O arquivo ${grande.name} passa de 25 MB. Envie uma versão menor (PDF comprimido ou foto).`);
      return;
    }
    setEnviando(true);

    const fd = new FormData();
    fd.set("dados", JSON.stringify({
      ...form,
      valor: reais(form.valor),
      area_declarada: form.area_declarada ? Number(form.area_declarada.replace(",", ".")) : null,
      municipality_id: form.municipality_id || null,
      caracteristicas: {
        unidade_area: form.tipo === "rural" ? "ha" : "m2",
        ...(form.medidas.trim() && { medidas_informadas: form.medidas.trim().slice(0, 2000) }),
      },
      condicao,
      aceite_termos: aceite,
      car_codigo: geometria.fonte === "car" ? car?.cod ?? null : null,
      lote_id: geometria.fonte === "lote" ? lote?.id ?? null : null,
      // preço vai como digitado ("85.000,50"): o servidor lê no formato brasileiro
      lotes: loteamento?.map((l) => ({ id: l.id, valor: l.valor.trim() || null, matricula_numero: l.matricula.trim() || null })),
      modalidade,
      leilao: emLeilao ? leilao : null,
    }));
    if (pedeSelfie && selfie) fd.set("selfie", selfie);
    fd.set("geometria", JSON.stringify(geometria));
    // fotos reduzidas no próprio aparelho (~0,5 MB cada) antes de subir
    const otimizadas = await comprimirFotos(fotos, (n) => setProgresso(`Otimizando fotos (${n} de ${fotos.length})…`));
    setProgresso("Enviando…");
    for (const f of otimizadas) fd.append("fotos", f);
    for (const [tipo, arquivos] of Object.entries(docs)) {
      for (const f of arquivos as File[]) fd.append(`doc_${tipo}`, f);
    }

    const res = await fetch("/api/imoveis", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      setErro(data.error ?? "Não foi possível enviar o imóvel.");
      setEnviando(false);
      return;
    }
    // vídeos vão depois de o imóvel existir, direto para o armazenamento
    const falhas: string[] = [];
    for (const [i, v] of videos.entries()) {
      setProgresso(`Enviando vídeo ${i + 1} de ${videos.length}…`);
      const problema = await enviarVideo(data.id, v);
      if (problema) falhas.push(problema);
    }
    router.push("/painel?enviado=" + data.codigo + (falhas.length ? "&videos_falharam=" + falhas.length : ""));
    router.refresh();
  }

  const input = CAMPO;
  const label = ROTULO;
  const ajuda = "mt-1.5 text-sm text-texto-2";

  // trilho de etapas (só leitura): mostra o caminho do cadastro e o que já está pronto
  const etapas = [
    ...(emLeilao ? [{ id: "leilao", rotulo: "Leilão", pronto: !!leilao.praca1_data }] : []),
    { id: "dados", rotulo: "Dados", pronto: !!form.titulo },
    { id: "localizacao", rotulo: "Localização", pronto: !!geometria },
    { id: "midia", rotulo: "Fotos e vídeos", pronto: fotos.length > 0 },
    { id: "documentos", rotulo: "Documentos", pronto: Object.values(docs).some((l) => l.length > 0) },
    { id: "condicao", rotulo: "Comercialização", pronto: ehEquipe || aceite },
  ];
  const numero = (id: string) => etapas.findIndex((e) => e.id === id) + 1;

  return (
    <form onSubmit={enviar} className="max-w-4xl space-y-8">
      <div>
        <h1 className="lp-display text-2xl md:text-[1.75rem] text-texto">Anunciar imóvel</h1>
        <p className="mt-1.5 text-base text-texto-2">
          Preencha os dados e marque a localização. O imóvel vai para a análise da Arini antes de publicar.
        </p>
      </div>

      <ol className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {etapas.map((e, i) => (
          <li key={e.id} className="shrink-0">
            <a href={`#${e.id}`}
              className={"flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors " +
                (e.pronto ? "border-verde/40 bg-verde/8 text-texto" : "border-linha text-texto-2 hover:border-linha-forte hover:text-texto")}>
              <span className={"grid size-6 place-items-center rounded-full text-xs font-bold " +
                (e.pronto ? "bg-verde text-fundo" : "bg-superficie-2 text-texto-2")}>
                {e.pronto ? <Check className="size-3.5" /> : i + 1}
              </span>
              {e.rotulo}
            </a>
          </li>
        ))}
      </ol>

      {(ehLeiloeiro || ehEquipe) && (
        <Etapa id="leilao" numero={emLeilao ? numero("leilao") : null} icone={Gavel} titulo="Leilão"
          subtitulo={ehEquipe ? "Só se o imóvel for vendido em leilão." : "Praças, lances e onde se dá o lance."}>
          {ehEquipe && (
            <label className="flex items-center gap-2.5 text-base text-texto">
              <input type="checkbox" className="size-4 accent-[var(--verde)]" checked={emLeilao} onChange={(e) => setModalidade(e.target.checked ? "leilao" : "venda")} />
              Este imóvel será vendido em leilão
            </label>
          )}
          {emLeilao && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={label}>1ª praça — data e hora *</label>
                <input type="datetime-local" className={input} value={leilao.praca1_data}
                  onChange={(e) => setLeilao({ ...leilao, praca1_data: e.target.value })} />
              </div>
              <div>
                <label className={label}>1ª praça — lance mínimo (R$)</label>
                <input className={input} inputMode="numeric" placeholder="Ex.: 420.000" value={leilao.praca1_lance}
                  onChange={(e) => setLeilao({ ...leilao, praca1_lance: e.target.value })} />
              </div>
              <div>
                <label className={label}>2ª praça — data e hora</label>
                <input type="datetime-local" className={input} value={leilao.praca2_data}
                  onChange={(e) => setLeilao({ ...leilao, praca2_data: e.target.value })} />
              </div>
              <div>
                <label className={label}>2ª praça — lance mínimo (R$)</label>
                <input className={input} inputMode="numeric" placeholder="Ex.: 252.000" value={leilao.praca2_lance}
                  onChange={(e) => setLeilao({ ...leilao, praca2_lance: e.target.value })} />
              </div>
              <div>
                <label className={label}>Processo / origem</label>
                <input className={input} placeholder="Nº do processo ou “extrajudicial”" value={leilao.processo}
                  onChange={(e) => setLeilao({ ...leilao, processo: e.target.value })} />
              </div>
              <div>
                <label className={label}>Comitente</label>
                <input className={input} placeholder="Banco, vara ou vendedor" value={leilao.comitente}
                  onChange={(e) => setLeilao({ ...leilao, comitente: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Página do leilão (onde se dá o lance)</label>
                <input className={input} type="url" placeholder="https://…" value={leilao.site}
                  onChange={(e) => setLeilao({ ...leilao, site: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Condições (comissão do leiloeiro, forma de pagamento, ocupação)</label>
                <textarea rows={2} className={input} value={leilao.condicoes}
                  onChange={(e) => setLeilao({ ...leilao, condicoes: e.target.value })} />
              </div>
            </div>
          )}
        </Etapa>
      )}

      <Etapa id="dados" numero={numero("dados")} icone={FileText} titulo="Dados do imóvel"
        subtitulo="O que o comprador vê primeiro no anúncio.">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={label}>Tipo</label>
            <select className={input} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              <option value="rural">Rural (fazenda, sítio, chácara)</option>
              <option value="urbano">Urbano (casa, lote, comercial)</option>
            </select>
          </div>
          <div>
            <label className={label}>Município</label>
            <select className={input} value={form.municipality_id}
              onChange={(e) => setForm({ ...form, municipality_id: e.target.value })}>
              <option value="">Detectar pelo mapa</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={label}>Título do anúncio</label>
          <input required className={input} placeholder='Ex.: "Fazenda dupla aptidão às margens da BR-364"'
            value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
        </div>

        <div>
          <label className={label}>Descrição</label>
          <textarea rows={5} className={input}
            placeholder="Benfeitorias, água, acesso, documentação, detalhes que valorizam o imóvel…"
            value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={label}>{loteamento ? "Preço padrão por lote (R$)" : "Valor pedido (R$)"}</label>
            <input className={input} placeholder={loteamento ? "Ex.: 85.000" : "Ex.: 3.800.000"} inputMode="numeric"
              value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
            {loteamento && <p className={ajuda}>Vale para todos os lotes; troque na tabela abaixo o que tiver preço diferente.</p>}
          </div>
          <div>
            <label className={label}>{loteamento ? "Área total dos lotes (m²)" : `Área declarada (${form.tipo === "rural" ? "hectares" : "m²"})`}</label>
            <input className={input} placeholder={form.tipo === "rural" ? "Ex.: 84" : "Ex.: 420"} inputMode="decimal"
              readOnly={!!loteamento}
              value={form.area_declarada} onChange={(e) => setForm({ ...form, area_declarada: e.target.value })} />
          </div>
        </div>

        {loteamento && (
          <TabelaLoteamento lotes={loteamento} precoPadrao={form.valor} onChange={setLoteamento} />
        )}

        {form.tipo === "urbano" && !loteamento && (
          <div>
            <label className={label}>Faz parte de um empreendimento? (opcional)</label>
            <input className={input} placeholder="Código do imóvel principal — ex.: AIB-000010"
              value={form.parent_codigo} onChange={(e) => setForm({ ...form, parent_codigo: e.target.value })} />
            <p className={ajuda}>
              Para apartamentos em bloco ou lotes de um loteamento: cadastre o empreendimento uma vez e
              aponte cada unidade para ele — a página do empreendimento lista todas as unidades à venda.
            </p>
          </div>
        )}

        <div>
          <label className={label}>Condições de venda</label>
          <textarea rows={2} className={input} placeholder="Entrada, parcelamento, prazo…"
            value={form.condicoes_venda} onChange={(e) => setForm({ ...form, condicoes_venda: e.target.value })} />
          <div className="mt-3 flex flex-wrap gap-5 text-base text-texto">
            {([["aceita_permuta", "Aceita permuta"], ["aceita_financiamento", "Aceita financiamento"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2.5">
                <input type="checkbox" className="size-4 accent-[var(--verde)]" checked={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
                {l}
              </label>
            ))}
          </div>
        </div>
      </Etapa>

      <Etapa id="localizacao" numero={numero("localizacao")} icone={MapPin} titulo="Localização no mapa"
        subtitulo="Desenhe a divisa, marque um ponto ou envie um KML.">
        {car && (
          <p className="flex items-start gap-2 rounded-xl border border-ouro/30 bg-ouro/10 px-4 py-3 text-sm text-texto">
            <Trees className="mt-0.5 size-4 shrink-0 text-ouro" />
            <span>
              Área do CAR <span className="font-mono">{car.cod}</span>
              {car.municipio && <> · {car.municipio}</>}
              {car.area_ha != null && <> · {Number(car.area_ha).toLocaleString("pt-BR")} ha declarados no CAR</>}
            </span>
          </p>
        )}
        {lote && (
          <p className="flex items-start gap-2 rounded-xl border border-ouro/30 bg-ouro/10 px-4 py-3 text-sm text-texto">
            <LandPlot className="mt-0.5 size-4 shrink-0 text-ouro" />
            <span>
              Lote da planta urbana{lote.municipio && <> de {lote.municipio}</>} · {lote.area_m2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m² medidos na planta
            </span>
          </p>
        )}
        {loteamento && (
          <p className="flex items-start gap-2 rounded-xl border border-ouro/30 bg-ouro/10 px-4 py-3 text-sm text-texto">
            <LandPlot className="mt-0.5 size-4 shrink-0 text-ouro" />
            <span>
              {loteamento.length} lotes da planta urbana{loteamento[0]?.municipio && <> de {loteamento[0].municipio}</>}. Cada
              lote vira uma unidade com a sua divisa; o empreendimento reúne todos. Para mudar a seleção, volte ao mapa.
            </span>
          </p>
        )}
        {loteamento ? (
          // a divisa de cada unidade é a do lote no banco: aqui só se confere
          <DesenhoMapa onChange={() => undefined} inicial={inicial} />
        ) : (
          <DesenhoMapa onChange={setGeometria} inicial={inicial}
            onSelecionar={(s) => (s.tipo === "car" ? carregarCar(s.cod) : carregarLote(s.id))} />
        )}
        {!loteamento && (
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-texto" htmlFor="medidas-area">
              Informações da área (opcional)
            </label>
            <textarea id="medidas-area" rows={3} value={form.medidas}
              onChange={(e) => setForm({ ...form, medidas: e.target.value })}
              placeholder="Ex.: frente 12 m, fundo 12 m, laterais 30 m; 360 m² na matrícula; divisa com o córrego ao norte."
              className="w-full rounded-xl border border-linha bg-superficie px-3.5 py-2.5 text-base text-texto outline-none focus:border-verde" />
            <p className="mt-1 text-sm text-texto-2">
              Lados, metragem e o que mais ajudar a conferir a divisa. A equipe Arini analisa e confirma antes de publicar.
            </p>
          </div>
        )}
        {geometria && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-verde">
            <CheckCircle2 className="size-4" />
            Geometria definida ({geometria.fonte === "ponto" ? "ponto" : geometria.fonte === "desenho" ? "desenho" : geometria.fonte === "car" ? "área do CAR" : geometria.fonte === "lote" ? "lote da planta urbana" : "arquivo " + geometria.fonte.toUpperCase()}).
          </p>
        )}
      </Etapa>

      <Etapa id="midia" numero={numero("midia")} icone={ImageIcon} titulo="Fotos e vídeos"
        subtitulo="Boas imagens fazem o anúncio ser aberto.">
        <div>
          <label className={label}>Fotos (até 20)</label>
          <input type="file" accept="image/*" multiple className={input}
            onChange={(e) => setFotos(Array.from(e.target.files ?? []).slice(0, 20))} />
          {fotos.length > 0 && <p className={ajuda}>{fotos.length === 1 ? "1 foto selecionada" : `${fotos.length} fotos selecionadas`}. A primeira vira capa.</p>}
        </div>

        <div>
          <label className={label}>Vídeos (até 3, opcional)</label>
          <input type="file" accept={VIDEO_ACEITA} multiple className={input}
            onChange={(e) => setVideos(Array.from(e.target.files ?? []).slice(0, 3))} />
          <p className={ajuda}>
            {videos.length
              ? `${videos.length} vídeo(s): ${videos.map((v) => `${v.name} (${(v.size / 1048576).toFixed(0)} MB)`).join(", ")}`
              : `MP4, MOV ou WebM, até ${VIDEO_MAX_MB} MB cada — de 1 a 2 minutos em 1080p.`}
          </p>
        </div>
      </Etapa>

      <Etapa id="documentos" numero={numero("documentos")} icone={ShieldCheck}
        titulo={`Comprovação de propriedade${ehEquipe ? "" : " *"}`}
        subtitulo={<>Nenhum imóvel é publicado sem a Arini conferir estes documentos. Eles ficam em área privada:
          só você e a equipe da Arini veem. PDF ou foto, até 25 MB cada.</>}>
        {/* número da matrícula (pedido do Carlos, 20/10/2026): a Matriz confere com o documento;
            o site público mostra só "matrícula conferida", nunca o número */}
        {!emLeilao && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="matricula_numero">Número da matrícula</label>
              <input id="matricula_numero" className={input} maxLength={120} placeholder="Ex.: 45413"
                value={form.matricula_numero} onChange={(e) => setForm({ ...form, matricula_numero: e.target.value })} />
              <p className={ajuda}>Está no topo do documento da matrícula. Se houver mais de uma, separe por vírgula.</p>
            </div>
            <div>
              <label className={label} htmlFor="matricula_cartorio">Cartório de registro</label>
              <input id="matricula_cartorio" className={input} maxLength={200} placeholder="Ex.: Cartório de Registro de Imóveis de Iturama"
                value={form.matricula_cartorio} onChange={(e) => setForm({ ...form, matricula_cartorio: e.target.value })} />
              <p className={ajuda}>Não aparece no site: só a Arini usa, para conferir e pedir o espelho.</p>
            </div>
          </div>
        )}
        {([
          ...(emLeilao ? [["edital", "Edital do leilão", "O edital publicado, com a descrição do bem, as praças e as condições.", !ehEquipe] as const] : []),
          ["matricula", "Matrícula atualizada do imóvel", "Ou escritura, contrato de compra e venda registrado, formal de partilha.", !ehEquipe && !emLeilao],
          ...(ehParceiro && !emLeilao ? [["autorizacao", "Autorização de venda assinada pelo proprietário", "Com prazo, preço e condições compatíveis com o anúncio.", true] as const] : []),
          ...(form.tipo === "rural" ? [["ccir_itr", "CCIR e/ou ITR", "Recomendado para imóvel rural — agiliza a análise.", false] as const] : []),
          ["outro", "Outros documentos", "Procuração, certidões, documento do cônjuge…", false],
        ] as const).map(([tipo, titulo, ajudaDoc, obrigatorio]) => (
          <div key={tipo}>
            <label className={label}>{titulo}{obrigatorio && " *"}</label>
            <input type="file" multiple accept={ACEITA_DOC} className={input}
              onChange={(e) => setDocs({ ...docs, [tipo]: Array.from(e.target.files ?? []).slice(0, 10) })} />
            <p className={ajuda}>
              {docs[tipo].length ? `${docs[tipo].length} arquivo(s): ${docs[tipo].map((f) => f.name).join(", ")}` : ajudaDoc}
            </p>
          </div>
        ))}
      </Etapa>

      <Etapa id="condicao" numero={numero("condicao")} icone={Handshake} titulo="Condição de comercialização *">
        {ehParceiro ? (
          <p className="text-base leading-relaxed text-texto-2">
            {ehLeiloeiro ? "Imóvel de leilão: a venda segue o edital, e a Arini encaminha os" : "Imóvel de parceiro: a autorização do proprietário é com você, e a Arini intermedia os"}{" "}
            interessados que chegam pela plataforma, conforme o{" "}
            <Link href="/termos/parceiros" target="_blank" className="text-verde underline">Termo de Parceria</Link>.
          </p>
        ) : (
          <div className="grid gap-4">
            {([
              ["exclusividade", "Exclusividade Arini", "Só a Arini (e parceiros indicados por ela) intermedia durante o prazo, com compromissos de prazo de atendimento."],
            ] as const).map(([v, t, d]) => (
              <label key={v}
                className={"cursor-pointer rounded-2xl border-2 p-5 transition-colors " +
                  (condicao === v ? "border-verde bg-verde/6" : "border-linha hover:border-linha-forte")}>
                <span className="flex items-center gap-2.5 text-base font-semibold text-texto">
                  <input type="radio" name="condicao" className="size-4 accent-[var(--verde)]" checked={condicao === v} onChange={() => setCondicao(v)} />
                  {t}
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-texto-2">{d}</span>
              </label>
            ))}
          </div>
        )}

        {pedeSelfie && (
          <div className="rounded-2xl border border-ouro/40 bg-ouro/5 p-5">
            <label className={label}>
              <span className="inline-flex items-center gap-2"><Camera className="size-4 text-ouro" /> Selfie de quem está aceitando a exclusividade *</span>
            </label>
            <input type="file" accept="image/*" capture="user" className={input}
              onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} />
            <p className={ajuda}>
              {selfie ? `Foto selecionada: ${selfie.name}. ` : ""}
              A foto fica guardada junto do aceite, em área privada, só para a Arini conferir com o seu
              documento. Não é usada para reconhecimento facial.
            </p>
          </div>
        )}

        {ehEquipe ? (
          <p className="text-sm text-texto-2">
            Cadastro feito pela equipe Arini: não há aceite eletrônico do proprietário. Anexe a
            autorização assinada em Documentos, na análise do imóvel.
          </p>
        ) : (
          <label className="flex items-start gap-3 rounded-xl bg-superficie-2 px-4 py-3.5 text-sm leading-relaxed text-texto-2">
            <input type="checkbox" required checked={aceite}
              onChange={(e) => setAceite(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--verde)]" />
            <span>
              {ehParceiro ? (
                <>{ehLeiloeiro
                  ? "Declaro estar habilitado a conduzir este leilão, nos termos do edital enviado, e aceito o"
                  : "Declaro ter autorização escrita do proprietário para anunciar este imóvel, no preço e nas condições acima, e aceito o"}{" "}
                <Link href="/termos/parceiros" target="_blank" className="text-verde underline">Termo de Parceria</Link></>
              ) : (
                <>Declaro ser proprietário (ou ter poderes para vender) e aceito o{" "}
                <Link href="/termos/autorizacao" target="_blank" className="text-verde underline">Termo de Autorização de Venda</Link>
                {condicao === "exclusividade" && <>, o{" "}
                  <Link href="/termos/exclusividade" target="_blank" className="text-verde underline">Termo de Exclusividade</Link>
                </>}</>
              )}
              {" "}e a{" "}
              <Link href="/termos/remuneracao" target="_blank" className="text-verde underline">Regra de Remuneração</Link>.
            </span>
          </label>
        )}
      </Etapa>

      <div className="flex flex-col gap-4 border-t border-linha pt-6 sm:flex-row sm:items-center sm:justify-between">
        {erro
          ? <p role="alert" className="flex items-start gap-2 text-base text-critico"><AlertTriangle className="mt-0.5 size-5 shrink-0" />{erro}</p>
          : <p className="text-sm text-texto-2">A Arini confere tudo antes de publicar. Você acompanha em Meus imóveis.</p>}
        <button disabled={enviando}
          className="lp-btn lp-btn-verde shrink-0 !px-6 !py-3.5 text-[0.95rem] disabled:opacity-60">
          {enviando ? (progresso || "Enviando…") : <>Enviar para análise da Arini <Send /></>}
        </button>
      </div>
    </form>
  );
}

/** Bloco numerado do cadastro (cartão com número, ícone e título no padrão do site). */
function Etapa({ id, numero, icone: Icone, titulo, subtitulo, children }: {
  id: string; numero: number | null; icone: LucideIcon; titulo: string; subtitulo?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section id={id} className="cartao scroll-mt-24 p-5 md:p-7">
      <header className="mb-6 flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
          <Icone className="size-5" />
        </span>
        <div className="min-w-0">
          {numero != null && <p className="lp-eyebrow text-xs">Etapa {numero}</p>}
          <h2 className="lp-display mt-1 text-xl md:text-2xl text-texto">{titulo}</h2>
          {subtitulo && <p className="mt-1.5 text-sm leading-relaxed text-texto-2 md:text-base">{subtitulo}</p>}
        </div>
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

/** Lotes do loteamento: um por linha, com preço (vazio = o padrão) e matrícula. */
function TabelaLoteamento({ lotes, precoPadrao, onChange }: {
  lotes: LoteDoLoteamento[];
  precoPadrao: string;
  onChange: (l: LoteDoLoteamento[]) => void;
}) {
  const mudar = (id: string, campo: "valor" | "matricula", v: string) =>
    onChange(lotes.map((l) => (l.id === id ? { ...l, [campo]: v } : l)));
  const celula = "w-full rounded-lg border border-linha bg-superficie px-2.5 py-1.5 text-sm text-texto placeholder:text-texto-2/70 focus:border-verde focus:outline-none";
  return (
    <div>
      <p className={ROTULO}>Lotes do loteamento ({lotes.length})</p>
      <div className="max-h-96 overflow-auto rounded-xl border border-linha">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-superficie-2 text-left text-xs uppercase tracking-wide text-texto-2">
            <tr>
              <th className="px-3 py-2 font-semibold">Lote</th>
              <th className="px-3 py-2 font-semibold text-right">Área</th>
              <th className="px-3 py-2 font-semibold">Preço (R$)</th>
              <th className="px-3 py-2 font-semibold">Nº da matrícula</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linha">
            {lotes.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-1.5 text-texto whitespace-nowrap">
                  {[l.quadra && `Qd. ${l.quadra}`, l.numero && `Lt. ${l.numero}`].filter(Boolean).join(" · ") || "Sem número na planta"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-texto-2 whitespace-nowrap">
                  {l.area_m2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
                </td>
                <td className="px-3 py-1.5 min-w-32">
                  <input className={celula} inputMode="numeric" placeholder={precoPadrao || "—"} aria-label="Preço do lote"
                    value={l.valor} onChange={(e) => mudar(l.id, "valor", e.target.value)} />
                </td>
                <td className="px-3 py-1.5 min-w-32">
                  <input className={celula} placeholder="Opcional" aria-label="Número da matrícula do lote"
                    value={l.matricula} onChange={(e) => mudar(l.id, "matricula", e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-sm text-texto-2">
        Os documentos enviados abaixo (matrícula do loteamento, autorização) valem para todos os lotes. A matrícula
        própria de cada lote pode ser anexada depois, na página de cada unidade.
      </p>
    </div>
  );
}
