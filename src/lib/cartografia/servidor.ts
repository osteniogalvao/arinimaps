import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emailDoProfile, sendEmail } from "@/lib/notify";
import { ARQUIVOS_ACEITOS, STATUS_SOLICITACAO_LABEL, type ArquivoSolicitacao, type StatusSolicitacao } from "./solicitacoes";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";
import { tipoReal } from "@/lib/seguranca/arquivos";

/**
 * Peças de servidor das solicitações cartográficas: referência (CAR/lote)
 * resolvida no NOSSO banco, arquivos no cofre privado, geometria por RPC e
 * aviso ao solicitante.
 */

export type ReferenciaResolvida = {
  tipo: "car" | "lote";
  codigo: string;
  rotulo: string;
  geometry: GeoJSON.Geometry;
  municipality_id: string | null;
};

const RE_REFERENCIA = /^(car:[A-Za-z0-9.\-_]{3,80}|lote:[0-9a-f-]{36})$/i;

export const referenciaValida = (ref: unknown): ref is string => typeof ref === "string" && RE_REFERENCIA.test(ref);

/**
 * "car:<cod>" → divisa do CAR; "lote:<uuid>" → lote da planta urbana. A
 * geometria vem do banco, não do navegador: quem manda o código não troca a
 * divisa no caminho. null quando a referência não existe.
 */
export async function resolverReferencia(ref: string | null | undefined): Promise<ReferenciaResolvida | null> {
  if (!referenciaValida(ref)) return null;
  const admin = supabaseAdmin();
  const [tipo, codigo] = ref.split(":", 2) as ["car" | "lote", string];
  if (tipo.toLowerCase() === "car") {
    const { data } = await admin.rpc("fn_car_imovel", { p_cod: codigo });
    const f = data as { geometry?: GeoJSON.Geometry; properties?: { cod?: string; municipio?: string | null; area_ha?: number | null } } | null;
    if (!f?.geometry) return null;
    const p = f.properties ?? {};
    return {
      tipo: "car", codigo, geometry: f.geometry, municipality_id: null,
      rotulo: `Área do CAR ${p.cod ?? codigo}${p.municipio ? ` · ${p.municipio}` : ""}${p.area_ha != null ? ` · ${Number(p.area_ha).toLocaleString("pt-BR")} ha` : ""}`,
    };
  }
  const { data } = await admin.rpc("fn_lote", { p_id: codigo });
  const f = data as { geometry?: GeoJSON.Geometry; properties?: { municipio?: string | null; municipality_id?: string | null; area_m2?: number | null } } | null;
  if (!f?.geometry) return null;
  const p = f.properties ?? {};
  return {
    tipo: "lote", codigo, geometry: f.geometry, municipality_id: p.municipality_id ?? null,
    rotulo: `Lote da planta urbana${p.municipio ? ` de ${p.municipio}` : ""}${p.area_m2 != null ? ` · ${Number(p.area_m2).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²` : ""}`,
  };
}

const CONTENT_TYPE: Record<string, string> = {
  kml: "application/vnd.google-earth.kml+xml", kmz: "application/vnd.google-earth.kmz", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  dxf: "application/dxf", zip: "application/zip",
};

const extensaoDe = (nome: string) => (nome.split(".").pop() ?? "").toLowerCase();

/** Lê os arquivos do campo `arquivos` do multipart e confere tipo, tamanho e quantidade. */
export async function lerArquivos(form: FormData): Promise<{ arquivos: File[]; erro: string | null }> {
  const arquivos = form.getAll("arquivos").filter((f): f is File => f instanceof File && f.size > 0);
  if (arquivos.length > ARQUIVOS_ACEITOS.maxQuantidade) {
    return { arquivos, erro: `Envie no máximo ${ARQUIVOS_ACEITOS.maxQuantidade} arquivos por vez.` };
  }
  for (const f of arquivos) {
    const ext = extensaoDe(f.name);
    if (!ARQUIVOS_ACEITOS.extensoes.includes(ext)) {
      return { arquivos, erro: `O arquivo ${f.name} não é de um tipo aceito (${ARQUIVOS_ACEITOS.extensoes.join(", ")}).` };
    }
    if (f.size > ARQUIVOS_ACEITOS.maxBytes) {
      return { arquivos, erro: `O arquivo ${f.name} passa de ${ARQUIVOS_ACEITOS.maxMB} MB.` };
    }
    const cabecalho = new Uint8Array(await f.slice(0, 4096).arrayBuffer());
    const esperado = ext === "jpeg" ? "jpg" : ext === "kmz" ? "zip" : ext;
    let valido = tipoReal(cabecalho, f.name) === esperado;
    if (ext === "kml") {
      const codificacao = cabecalho[0] === 0xff && cabecalho[1] === 0xfe ? "utf-16le"
        : cabecalho[0] === 0xfe && cabecalho[1] === 0xff ? "utf-16be" : "utf-8";
      const inicio = new TextDecoder(codificacao).decode(cabecalho);
      valido = /^\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?kml(?=[\s/>])/.test(inicio);
    } else if (ext === "dxf" && !valido) {
      valido = new TextDecoder().decode(cabecalho.subarray(0, 22)) === "AutoCAD Binary DXF\r\n\x1a\0";
    }
    if (!valido) {
      return { arquivos, erro: `O conteúdo de ${f.name} não corresponde ao formato .${ext}.` };
    }
  }
  return { arquivos, erro: null };
}

const nomeSeguro = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "arquivo";

/**
 * Sobe os arquivos para o bucket privado `docs`, em cartografia/<protocolo>/.
 * `inicio` é o número do próximo arquivo (para anexos enviados depois).
 */
export async function subirArquivos(protocolo: string, arquivos: File[], inicio = 1) {
  const admin = supabaseAdmin();
  const salvos: ArquivoSolicitacao[] = [];
  const falharam: string[] = [];
  let n = inicio;
  for (const f of arquivos) {
    const ext = extensaoDe(f.name);
    const path = `cartografia/${protocolo}/${n}-${nomeSeguro(f.name)}`;
    const { error } = await admin.storage.from("docs")
      .upload(path, await f.arrayBuffer(), { contentType: CONTENT_TYPE[ext] || "application/octet-stream", upsert: true });
    if (error) { falharam.push(f.name); continue; }
    salvos.push({ nome: f.name, path, tipo: ext, bytes: f.size });
    n++;
  }
  return { salvos, falharam };
}

/**
 * Endereços para abrir os arquivos de uma solicitação. Passam por
 * /api/arquivos, que confere a permissão a cada clique, registra quem abriu
 * (item 6.3) e só então assina por 60 s — o link da tela não vaza o arquivo.
 */
export async function assinarArquivos(arquivos: ArquivoSolicitacao[]) {
  return arquivos.map((a) => ({ ...a, url: urlArquivo(a.path) as string | null }));
}

export type GeoSolicitacao = { ponto: GeoJSON.Point | null; geom: GeoJSON.Geometry | null; area_m2: number | null };

/** Ponto e área da solicitação como GeoJSON. */
export async function geojsonDaSolicitacao(id: string): Promise<GeoSolicitacao> {
  const { data } = await supabaseAdmin().rpc("fn_cart_request_geojson", { p_id: id });
  const g = (data ?? {}) as Partial<GeoSolicitacao>;
  return { ponto: g.ponto ?? null, geom: g.geom ?? null, area_m2: g.area_m2 != null ? Number(g.area_m2) : null };
}

/** E-mail ao solicitante quando a solicitação muda de situação ou recebe devolutiva. Nunca lança. */
export async function avisarSolicitante(
  req: { user_id: string; protocolo: string },
  status: StatusSolicitacao | null,
  texto: string | null
) {
  try {
    const email = await emailDoProfile(req.user_id);
    if (!email) return;
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const assunto = status
      ? `Solicitação ${req.protocolo}: ${STATUS_SOLICITACAO_LABEL[status]}`
      : `Solicitação ${req.protocolo}: resposta da equipe de cartografia`;
    const corpo = [
      `Olá! Sua solicitação cartográfica ${req.protocolo}${status ? ` agora está "${STATUS_SOLICITACAO_LABEL[status]}"` : " recebeu uma resposta"}.`,
      texto ? `\n${texto}` : "",
      status === "aguardando_documentacao" ? "\nAcesse a solicitação para enviar o que falta." : "",
      `\nAcompanhe em ${site}/painel/cartografia`,
      "\nLembrete: a área informada na solicitação só passa a valer no mapa depois da validação da Matriz.",
    ].join("\n");
    await sendEmail(email, assunto, corpo);
  } catch (e) {
    console.error("avisarSolicitante falhou:", e);
  }
}
