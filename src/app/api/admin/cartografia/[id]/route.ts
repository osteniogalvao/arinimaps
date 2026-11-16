import { isDeepStrictEqual } from "node:util";
import { union } from "polyclip-ts";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { falha, falhaBanco } from "@/lib/erros";
import { gerarPlantaPublica } from "@/lib/geo/plantaPublica";
import {
  afim, compor, inverter, matrizParte, aneisParte, centroDe, partesSobrepostas, assinaturaAjustes, assinaturaEdicoes, CHAVE_LINHA,
  type AjusteLocal, type EdicaoGeometria, type Matriz, type Transform,
} from "@/lib/geo/deslocar";

/**
 * Calibração da planta: deslocamento em metros, giro, escala, camadas do CAD
 * visíveis, opacidade e faixa de zoom. Cada limite abaixo tem motivo:
 * calibração não é lugar de mover a planta para outra cidade nem de espremer o
 * desenho até ele deixar de ser a planta — quando o número foge da faixa, o
 * problema é o arquivo, não o ajuste.
 */
const LIMITES = {
  offset: 5_000,     // 5 km: acima disso não é erro de datum, é planta errada
  rotacao: 360,
  escalaMin: 0.5,
  escalaMax: 2,
  // parte da planta: é ajuste fino de quadra ou bairro, não de datum
  parteOffset: 500,
  // esticar uma quadra ou bairro (áudio do Carlos, 09/11/2026): ajuste fino, não redesenho
  parteEscalaMin: 0.8,
  parteEscalaMax: 1.25,
  partes: 100,
  verticesArea: 300,
  // A planta municipal de Iturama tem mais de 200 mil linhas.
  linhasExcluidas: 300_000,
  espessuraMin: 0.25,
  espessuraMax: 5,
  edicoes: 100_000,
  verticesLinha: 2_000,
  verticesEditadosTotal: 500_000,
};

function lerEdicoes(v: unknown): { ok: true; edicoes: EdicaoGeometria[] } | { ok: false; motivo: string } {
  if (!Array.isArray(v)) return { ok: false, motivo: "as correções de linha não vieram como lista" };
  if (v.length > LIMITES.edicoes) return { ok: false, motivo: `correções demais (limite ${LIMITES.edicoes})` };
  const fin = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const edicoes: EdicaoGeometria[] = [];
  let totalVertices = 0;
  for (const [i, item] of v.entries()) {
    const e = item as Partial<EdicaoGeometria> | null;
    if (!e || !Number.isInteger(e.feature) || e.feature! < 0 || !Number.isInteger(e.linha) || e.linha! < 0) {
      return { ok: false, motivo: `correção ${i + 1} sem identificador de linha válido` };
    }
    if (!Array.isArray(e.coordinates) || e.coordinates.length < 2 || e.coordinates.length > LIMITES.verticesLinha ||
        !e.coordinates.every((p) => Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) {
      return { ok: false, motivo: `correção ${i + 1} precisa de 2 a ${LIMITES.verticesLinha} vértices válidos` };
    }
    totalVertices += e.coordinates.length;
    // pedaços de uma linha dividida (ver EdicaoGeometria.extras)
    const extras: [number, number][][] = [];
    if (e.extras !== undefined) {
      if (!Array.isArray(e.extras) || e.extras.length > 50) return { ok: false, motivo: `correção ${i + 1} com pedaços inválidos` };
      for (const x of e.extras) {
        if (!Array.isArray(x) || x.length < 2 || x.length > LIMITES.verticesLinha ||
            !x.every((p) => Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) {
          return { ok: false, motivo: `correção ${i + 1}: cada pedaço precisa de 2 a ${LIMITES.verticesLinha} vértices válidos` };
        }
        totalVertices += x.length;
        extras.push(x.map((p) => [Number(p[0]), Number(p[1])] as [number, number]));
      }
    }
    if (totalVertices > LIMITES.verticesEditadosTotal) return { ok: false, motivo: `correções acima de ${LIMITES.verticesEditadosTotal} vértices no total` };
    if (e.criar && (e.linha !== 0 || e.coordinates.length < 4 ||
      e.coordinates[0][0] !== e.coordinates.at(-1)![0] || e.coordinates[0][1] !== e.coordinates.at(-1)![1])) {
      return { ok: false, motivo: "O novo polígono deve ter um contorno fechado." };
    }
    edicoes.push({
      ...(e.criar === true ? { criar: true } : {}),
      feature: e.feature!, linha: e.linha!, coordinates: e.coordinates.map((p) => [Number(p[0]), Number(p[1])]),
      ...(extras.length ? { extras } : {}),
    });
  }
  return { ok: true, edicoes };
}

/**
 * Lê as partes ajustadas que a tela mandou. Devolve a lista limpa ou o motivo
 * da recusa. A área é imutável depois de criada: mudar o contorno é apagar a
 * parte e desenhar outra (a tela faz assim), e é isso que mantém o mover-no-
 * lugar dos lotes simples — o mesmo id sempre cobre os mesmos lotes.
 */
function lerAjustes(v: unknown): { ok: true; ajustes: AjusteLocal[] } | { ok: false; motivo: string } {
  if (!Array.isArray(v)) return { ok: false, motivo: "a lista de partes não veio como lista" };
  if (v.length > LIMITES.partes) return { ok: false, motivo: `${v.length} partes (limite ${LIMITES.partes})` };
  const fin = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const ajustes: AjusteLocal[] = [];
  for (const [i, bruto] of v.entries()) {
    const a = bruto as Partial<AjusteLocal> | null;
    const nomeParte = `parte ${i + 1}`;
    if (!a || typeof a.id !== "string" || !/^[a-z0-9-]{4,40}$/i.test(a.id)) return { ok: false, motivo: `${nomeParte} sem identificador válido` };
    if (ajustes.some(p => p.id === a.id)) return { ok: false, motivo: `${nomeParte}: identificador duplicado` };
    if (!Array.isArray(a.area) || (a.areasExtras !== undefined && !Array.isArray(a.areasExtras))) {
      return { ok: false, motivo: `${nomeParte}: perímetros inválidos` };
    }
    const aneis = [a.area, ...(a.areasExtras ?? [])];
    if (aneis.length > 100 || aneis.some(anel => !Array.isArray(anel) || anel.length < 3 ||
        anel.length > LIMITES.verticesArea || !anel.every(p => Array.isArray(p) && fin(p[0]) && fin(p[1]) &&
          Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) || aneis.reduce((s, anel) => s + anel.length, 0) > 1_000) {
      return { ok: false, motivo: `${nomeParte}: a área precisa de 3 a ${LIMITES.verticesArea} pontos válidos` };
    }
    if (a.grupo !== undefined && (typeof a.grupo !== "string" || !/^[a-z0-9-]{4,40}$/i.test(a.grupo))) {
      return { ok: false, motivo: `${nomeParte}: identificador do conjunto inválido` };
    }
    if (a.pivo !== undefined && (!Array.isArray(a.pivo) || a.pivo.length !== 2 ||
        !a.pivo.every(fin) || Math.abs(a.pivo[0]) > 180 || Math.abs(a.pivo[1]) > 90)) {
      return { ok: false, motivo: `${nomeParte}: centro do conjunto inválido` };
    }
    const m = a.encaixe;
    if (m !== undefined && (!m || ![m.a, m.b, m.d, m.e, m.xoff, m.yoff].every(fin) ||
        Math.max(...[m.a, m.b, m.d, m.e].map(Math.abs)) > 100 || Math.abs(m.xoff) > 36_000 || Math.abs(m.yoff) > 18_000 || !(m.a * m.e - m.b * m.d > 1e-10))) {
      return { ok: false, motivo: `${nomeParte}: encaixe inválido` };
    }
    const t = a.t as Partial<Transform> | undefined;
    if (!t || !fin(t.offsetLesteM) || !fin(t.offsetNorteM) || !fin(t.rotacaoGraus)) return { ok: false, motivo: `${nomeParte} sem deslocamento válido` };
    if (Math.abs(t.offsetLesteM!) > LIMITES.parteOffset || Math.abs(t.offsetNorteM!) > LIMITES.parteOffset) {
      return { ok: false, motivo: `${nomeParte}: deslocamento acima de ${LIMITES.parteOffset} m` };
    }
    if (Math.abs(t.rotacaoGraus!) > LIMITES.rotacao) return { ok: false, motivo: `${nomeParte}: giro acima de ${LIMITES.rotacao}°` };
    const escalaParte = t.escala === undefined || t.escala === null ? 1 : t.escala;
    if (!fin(escalaParte) || escalaParte < LIMITES.parteEscalaMin || escalaParte > LIMITES.parteEscalaMax) {
      return { ok: false, motivo: `${nomeParte}: tamanho fora de ${LIMITES.parteEscalaMin * 100}% a ${LIMITES.parteEscalaMax * 100}%` };
    }
    ajustes.push({
      id: a.id,
      ...(a.grupo ? { grupo: a.grupo } : {}),
      ...(a.pivo ? { pivo: a.pivo } : {}),
      ...(m ? { encaixe: { a: m.a, b: m.b, d: m.d, e: m.e, xoff: m.xoff, yoff: m.yoff } } : {}),
      ...(typeof a.nomeCad === "string" && a.nomeCad.trim() ? { nomeCad: a.nomeCad.trim().slice(0, 150) } : {}),
      nome: (typeof a.nome === "string" && a.nome.trim() ? a.nome.trim() : nomeParte).slice(0, 60),
      area: a.area.map((p) => [Number(p[0]), Number(p[1])] as [number, number]),
      ...(a.areasExtras?.length ? { areasExtras: a.areasExtras.map(anel => anel.map(([x, y]) => [x, y] as [number, number])) } : {}),
      t: {
        offsetLesteM: Math.round(t.offsetLesteM! * 100) / 100,
        offsetNorteM: Math.round(t.offsetNorteM! * 100) / 100,
        rotacaoGraus: Math.round(t.rotacaoGraus! * 1e4) / 1e4,
        // esticar a parte (09/11/2026): 1 = só desloca e gira, o lote mantém a área medida
        escala: Math.round(escalaParte * 1e6) / 1e6,
      },
    });
  }
  for (let i = 0; i < ajustes.length; i++) {
    for (let j = i + 1; j < ajustes.length; j++) {
      if (partesSobrepostas(ajustes[i], ajustes[j])) {
        return { ok: false, motivo: `as áreas de "${ajustes[i].nome}" e "${ajustes[j].nome}" se sobrepõem` };
      }
    }
  }
  return { ok: true, ajustes };
}

const CAMPOS_GLOBAIS = ["offset_leste_m", "offset_norte_m", "rotacao_graus", "escala"] as const;
const vetor = (m: Matriz) => [m.a, m.b, m.d, m.e, m.xoff, m.yoff];
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/cartografia/[id]">) {
  const { id } = await ctx.params;
  // fora do matcher do proxy (arquivos grandes): a conferência de origem (CSRF) é aqui
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || !temSetor(a, "cartografia")) {
    return falha(403, "sem_permissao", "Restrito à equipe da Arini.", {
      solucao: "Entre com uma conta da Arini para calibrar a cartografia.",
    });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return falha(400, "corpo_invalido", "O pedido chegou sem dados.", {
      motivo: "O corpo da requisição não é JSON válido.",
      solucao: "Recarregue a página e tente de novo.",
    });
  }

  const patch: Record<string, unknown> = {};
  const fora: string[] = [];
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

  const leste = num(body.offset_leste_m);
  if (leste !== null) {
    if (Math.abs(leste) > LIMITES.offset) fora.push(`deslocamento leste de ${leste.toFixed(0)} m (limite ${LIMITES.offset} m)`);
    else patch.offset_leste_m = leste;
  }
  const norte = num(body.offset_norte_m);
  if (norte !== null) {
    if (Math.abs(norte) > LIMITES.offset) fora.push(`deslocamento norte de ${norte.toFixed(0)} m (limite ${LIMITES.offset} m)`);
    else patch.offset_norte_m = norte;
  }
  const rot = num(body.rotacao_graus);
  if (rot !== null) {
    if (Math.abs(rot) > LIMITES.rotacao) fora.push(`giro de ${rot.toFixed(2)}° (limite ${LIMITES.rotacao}°)`);
    else patch.rotacao_graus = rot;
  }
  const esc = num(body.escala);
  if (esc !== null) {
    if (esc < LIMITES.escalaMin || esc > LIMITES.escalaMax) fora.push(`escala ${esc.toFixed(3)}× (faixa ${LIMITES.escalaMin}–${LIMITES.escalaMax})`);
    else patch.escala = esc;
  }
  const op = num(body.opacidade);
  if (op !== null) patch.opacidade_padrao = Math.min(1, Math.max(0.05, op));
  const mz = num(body.min_zoom);
  if (mz !== null) patch.min_zoom = Math.min(18, Math.max(0, Math.round(mz)));
  if (Array.isArray(body.layers_ocultos)) {
    patch.layers_ocultos = body.layers_ocultos.map(String).slice(0, 500);
  }
  if (Array.isArray(body.linhas_excluidas)) {
    const chaves = [...new Set(body.linhas_excluidas.map(String))] as string[];
    if (chaves.length > LIMITES.linhasExcluidas) fora.push(`${chaves.length} linhas apagadas (limite ${LIMITES.linhasExcluidas})`);
    else if (chaves.some((k) => !CHAVE_LINHA.test(k))) fora.push("a lista de linhas apagadas tem itens inválidos");
    else patch.linhas_excluidas = chaves.sort();
  }
  const espessura = num(body.espessura_linha);
  if (espessura !== null) patch.espessura_linha = Math.round(Math.min(LIMITES.espessuraMax, Math.max(LIMITES.espessuraMin, espessura)) * 100) / 100;
  if (Array.isArray(body.pontos_controle)) {
    patch.pontos_controle = body.pontos_controle.slice(0, 20);
  }
  if (typeof body.datum === "string" && ["sirgas", "sad69", "corrego"].includes(body.datum)) {
    patch.datum = body.datum;
  }
  if (body.ajustes_locais !== undefined) {
    const lidos = lerAjustes(body.ajustes_locais);
    if (!lidos.ok) fora.push(lidos.motivo);
    else patch.ajustes_locais = lidos.ajustes;
  }
  if (body.edicoes_geometria !== undefined) {
    const lidas = lerEdicoes(body.edicoes_geometria);
    if (!lidas.ok) fora.push(lidas.motivo);
    else patch.edicoes_geometria = lidas.edicoes;
  }
  if (body.apelidos_cad !== undefined) {
    const nomes = body.apelidos_cad;
    if (!nomes || typeof nomes !== "object" || Array.isArray(nomes) ||
      Object.entries(nomes).some(([origem, novo]) => !origem || typeof novo !== "string" || !novo.trim() || novo.length > 100)) {
      fora.push("os apelidos das camadas precisam ter de 1 a 100 caracteres");
    } else patch.apelidos_cad = nomes;
  }

  if (fora.length) {
    return falha(400, "ajuste_fora_da_faixa", "O ajuste pedido está fora do que a calibração aceita.", {
      motivo: fora.join("; ") + ".",
      solucao: "Um desvio dessa ordem quase sempre é zona UTM ou município errado no envio — reenvie a planta em vez de forçar o ajuste.",
      detalhes: { limites: LIMITES },
    });
  }
  if (!Object.keys(patch).length) {
    return falha(400, "nada_para_ajustar", "Nenhum valor válido chegou para ajustar.", {
      motivo: "O pedido não trouxe deslocamento, giro, escala, opacidade nem seleção de camadas.",
      solucao: "Mova a planta ou marque as camadas antes de salvar.",
    });
  }

  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("cartography_layers")
    .select("nome, tipo, tiles_path, publico_path, publico_centro, offset_leste_m, offset_norte_m, rotacao_graus, escala, layers_ocultos, linhas_excluidas, ajustes_locais, edicoes_geometria, lotes_total, lotes_assinatura, diagnostico")
    .eq("id", id).single();
  if (!antes) {
    return falha(404, "camada_sumiu", "Essa camada não existe mais.", {
      motivo: "Ela pode ter sido removida ou substituída por um envio novo enquanto a tela estava aberta.",
      solucao: "Feche a calibração e recarregue a lista de camadas.",
    });
  }

  let publico: Awaited<ReturnType<typeof gerarPlantaPublica>> | null = null;
  if (patch.apelidos_cad) {
    const conhecidas = new Set(((antes.diagnostico?.layers ?? []) as { nome: string }[]).map(l => l.nome));
    if (!Object.keys(patch.apelidos_cad).every(k => conhecidas.has(k))) {
      return falha(400, "camada_cad_desconhecida", "Um dos nomes de origem não existe nesta planta.");
    }
  }
  const mudouCamadas = Array.isArray(patch.layers_ocultos) &&
    [...(patch.layers_ocultos as string[])].sort().join("|") !== [...((antes.layers_ocultos as string[] | null) ?? [])].sort().join("|");
  const excluidasAntes = ((antes.linhas_excluidas as string[] | null) ?? []);
  const excluidasDepois = (patch.linhas_excluidas as string[] | undefined) ?? excluidasAntes;
  const mudouExcluidas = [...excluidasAntes].sort().join(",") !== [...excluidasDepois].sort().join(",");
  const mudouGeometria = patch.edicoes_geometria !== undefined &&
    !isDeepStrictEqual(patch.edicoes_geometria, antes.edicoes_geometria ?? []);
  // planta sem arquivo público (enviada antes de 09/11/2026): gera agora, para
  // o mapa público deixar de depender da URL do original
  const semPublico = !antes.publico_path;
  // mexeu na posição da planta inteira ou nas camadas: os lotes clicáveis
  // precisam ser refeitos para continuar em cima das linhas que o usuário vê.
  // A tela manda todos os campos a cada salvamento, então a comparação é com o
  // que estava gravado — antes, salvar só uma parte refazia a cidade inteira.
  const difere = (novo: unknown, velho: unknown, tol: number) =>
    novo !== undefined && Math.abs(Number(novo) - Number(velho ?? 0)) > tol;
  const camadasAntes = [...((antes.layers_ocultos as string[] | null) ?? [])].sort().join("|");
  const mexeuNoGlobal =
    difere(patch.offset_leste_m, antes.offset_leste_m, 0.005) || difere(patch.offset_norte_m, antes.offset_norte_m, 0.005) ||
    difere(patch.rotacao_graus, antes.rotacao_graus, 1e-5) || (patch.escala !== undefined && Math.abs(Number(patch.escala) - Number(antes.escala ?? 1)) > 1e-7);
  const mudouTracado = (Array.isArray(patch.layers_ocultos) && [...(patch.layers_ocultos as string[])].sort().join("|") !== camadasAntes) ||
    // linha apagada ou corrigida muda as quadras: os lotes são refeitos
    mudouExcluidas || mudouGeometria;

  const ajustesAntes = ((antes.ajustes_locais as AjusteLocal[] | null) ?? []);
  const ajustesDepois = (patch.ajustes_locais as AjusteLocal[] | undefined) ?? ajustesAntes;
  if (body.ajustes_base !== undefined && !isDeepStrictEqual(body.ajustes_base, ajustesAntes) && !isDeepStrictEqual(ajustesDepois, ajustesAntes)) {
    return falha(409, "calibracao_concorrente", "Outra pessoa salvou as peças desde que você abriu a planta.", {
      solucao: "Reabra o editor para usar o encaixe gravado."
    });
  }
  const mexeuNasPartes = !isDeepStrictEqual(ajustesAntes, ajustesDepois);


  const aplicarPartesNoBanco = antes.tipo === "vector" && !mudouTracado && (mexeuNoGlobal || mexeuNasPartes) && !!antes.lotes_total;
  const transformAntes = Object.fromEntries(CAMPOS_GLOBAIS.map(k => [k, Number(antes[k] ?? (k === "escala" ? 1 : 0))]));
  const transformDepois = Object.fromEntries(CAMPOS_GLOBAIS.map(k => [k, Number(patch[k] ?? transformAntes[k])]));
  if (body.transform_base && CAMPOS_GLOBAIS.some(k => !Number.isFinite(body.transform_base[k]) || Math.abs(body.transform_base[k] - transformAntes[k]) > (k === "escala" ? 1e-6 : k === "rotacao_graus" ? 1e-4 : .01)) && !isDeepStrictEqual(transformDepois, transformAntes)) {
    return falha(409, "calibracao_concorrente", "A posição desta planta mudou durante a edição.", { solucao: "Reabra o editor para usar a posição atual." });
  }
  const patchVisual = { ...patch };
  if (aplicarPartesNoBanco) {
    delete patchVisual.ajustes_locais;
    for (const k of CAMPOS_GLOBAIS) delete patchVisual[k];
  }
  if ((mudouCamadas || mudouExcluidas || mudouGeometria || semPublico) && antes.tipo === "vector" && antes.tiles_path) {
    try {
      publico = await gerarPlantaPublica(
        admin, { id, tiles_path: antes.tiles_path, publico_path: antes.publico_path },
        (patch.layers_ocultos as string[] | undefined) ?? ((antes.layers_ocultos as string[] | null) ?? []),
        excluidasDepois,
        (patch.edicoes_geometria as EdicaoGeometria[] | undefined) ?? ((antes.edicoes_geometria as EdicaoGeometria[] | null) ?? []), patchVisual
      );
    } catch (e) {
      return falha(409, "planta_nao_publicada", "A calibração não foi publicada.", { motivo: e instanceof Error ? e.message : String(e) });
    }
  } else if (Object.keys(patchVisual).length) {
    const { error } = await admin.from("cartography_layers").update(patchVisual).eq("id", id);
    if (error) return falhaBanco("calibracao_nao_gravou", error);
  }

  let lotesMovidos: number | null = null;

  if (antes.tipo === "vector" && (mudouTracado || ((mexeuNoGlobal || mexeuNasPartes) && !antes.lotes_total))) {
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
      .eq("tipo", "gerar_lotes").eq("status", "pendente").contains("payload", { layer_id: id });
    if (!count) await admin.from("jobs").insert({ tipo: "gerar_lotes", payload: { layer_id: id } });
  } else if (aplicarPartesNoBanco) {
    // A planta ou as peças mudaram de posição. Os lotes acompanham e mantêm a
    // numeração de quadra e lote (refazer a cidade apagaria a numeração)
    try {
      lotesMovidos = await moverLotesDasPartes(admin, id, antes, ajustesAntes, ajustesDepois, a.userId, transformAntes, transformDepois);
    } catch (e) {
      return falha(409, "ajustes_nao_gravados", "As peças e os lotes mantiveram os encaixes anteriores.", {
        motivo: e instanceof Error ? e.message : String(e),
        solucao: "Confira a mensagem e recarregue a planta se outro operador tiver salvado antes."
      });
    }
  }

  await logAudit({
    user_id: a.userId, acao: "cartografia_calibrada",
    entidade: "cartography_layers", entidade_id: id,
    dados_antes: antes, dados_depois: { ...patch, publico_bytes: publico?.bytes ?? undefined },
  });
  return NextResponse.json({
    ok: true, aplicado: patch,
    publico: publico && { bytes: publico.bytes, linhas: publico.linhas, linhas_total: publico.linhasTotal },
    aviso_publico: null,
    lotes_movidos: lotesMovidos,
    aviso_lotes: null,
  });
}

/**
 * Move os lotes clicáveis de todas as peças em uma única transação.
 * A função também grava as peças, a assinatura e a data dos lotes,
 * para o mapa pedir os tiles novos — mas só se os lotes estavam em dia; se já
 * estavam defasados, continuam marcados como defasados.
 */
async function moverLotesDasPartes(
  admin: ReturnType<typeof supabaseAdmin>,
  id: string,
  antes: Record<string, unknown>,
  velhos: AjusteLocal[],
  novos: AjusteLocal[],
  autor: string,
  transformAntes: Record<string, number>, transformDepois: Record<string, number>,
): Promise<number> {
  let centro = Array.isArray(antes.publico_centro) && antes.publico_centro.length === 2
    ? (antes.publico_centro as [number, number]) : null;
  if (!centro) {
    const { data } = admin.storage.from("media").getPublicUrl(String(antes.tiles_path));
    const fc = await fetch(data.publicUrl).then((r) => r.json()).catch(() => null);
    if (!fc?.features) throw new Error("não consegui ler a planta para achar o centro da calibração");
    centro = centroDe(fc);
  }
  const global = (v: Record<string, number>) => afim(centro, {
    offsetLesteM: v.offset_leste_m, offsetNorteM: v.offset_norte_m, rotacaoGraus: v.rotacao_graus, escala: v.escala,
  });
  const g = global(transformAntes), gNovo = global(transformDepois);
  const descrever = (partes: AjusteLocal[], global: Matriz) => partes.map(parte => {
    const [primeiro, ...extras] = aneisParte(parte);
    const area = extras.length
      ? { type: "MultiPolygon", coordinates: union([primeiro], ...extras.map(anel => [anel])) }
      : { type: "Polygon", coordinates: [[...primeiro, primeiro[0]]] };
    const posicao = compor(global, matrizParte(parte));
    return { area, m: vetor(posicao), inv: vetor(inverter(posicao)) };
  });
  const assinatura = String(antes.lotes_assinatura ?? "");
  const ed = assinaturaEdicoes((antes.edicoes_geometria ?? []) as EdicaoGeometria[]);
  const sufixo = assinaturaAjustes(velhos) + ed;
  const emDia = assinatura && (sufixo ? assinatura.endsWith(sufixo) : !assinatura.includes(";aj:"));
  const base = (sufixo ? assinatura.slice(0, -sufixo.length) : assinatura).split(";");
  const globalEmDia = CAMPOS_GLOBAIS.every((k, i) => base[i] !== undefined && Number(base[i]) === transformAntes[k]);
  CAMPOS_GLOBAIS.forEach((k, i) => { if (transformDepois[k] !== transformAntes[k]) base[i] = String(transformDepois[k]); });
  const { data, error } = await admin.rpc("fn_cartografia_salvar_partes", {
    p_layer: id, p_antes: antes.ajustes_locais ?? null, p_depois: novos, p_antigas: descrever(velhos, g), p_novas: descrever(novos, gNovo),
    p_global: vetor(g), p_inv_global: vetor(inverter(g)), p_global_novo: vetor(gNovo),
    p_transform_antes: transformAntes, p_transform_depois: transformDepois, p_assinatura: antes.lotes_assinatura,
    p_nova_assinatura: emDia && globalEmDia ? base.join(";") + assinaturaAjustes(novos) + ed : antes.lotes_assinatura, p_autor: autor,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/cartografia/[id]">) {
  const { id } = await ctx.params;
  // fora do matcher do proxy (arquivos grandes): a conferência de origem (CSRF) é aqui
  const origem = conferirOrigem(_request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (a?.role !== "admin_central") {
    return falha(403, "sem_permissao", "Só a diretoria remove camadas do mapa.", {
      motivo: `Seu acesso é "${a?.role ?? "sem sessão"}".`,
      solucao: "Peça a alguém da diretoria, ou esconda as camadas do CAD em vez de remover a planta.",
    });
  }
  const admin = supabaseAdmin();
  const { data: camada } = await admin.from("cartography_layers").select("tiles_path, nome").eq("id", id).single();
  if (!camada) {
    return falha(404, "camada_sumiu", "Essa camada já não existe.", {
      solucao: "Recarregue a lista.",
    });
  }
  const { error } = await admin.from("cartography_layers").delete().eq("id", id);
  if (error) return falhaBanco("camada_nao_removeu", error);

  await logAudit({
    user_id: a.userId, acao: "cartografia_removida",
    entidade: "cartography_layers", entidade_id: id, dados_antes: { nome: camada.nome },
  });
  return NextResponse.json({ ok: true });
}
