import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { falha, falhaBanco } from "@/lib/erros";
import { gerarPlantaPublica } from "@/lib/geo/plantaPublica";
import {
  afim, compor, inverter, centroArea, centroDe, areasSeSobrepoem, assinaturaAjustes, TRANSFORM_ZERO,
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
  rotacao: 45,       // planta de cidade não vem girada meia-volta
  escalaMin: 0.5,
  escalaMax: 2,
  // parte da planta: é ajuste fino de quadra ou bairro, não de datum
  parteOffset: 500,
  partes: 100,
  verticesArea: 300,
  edicoes: 2_000,
  verticesLinha: 2_000,
  verticesEditadosTotal: 50_000,
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
    if (totalVertices > LIMITES.verticesEditadosTotal) return { ok: false, motivo: `correções acima de ${LIMITES.verticesEditadosTotal} vértices no total` };
    edicoes.push({ feature: e.feature!, linha: e.linha!, coordinates: e.coordinates.map((p) => [Number(p[0]), Number(p[1])]) });
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
    if (!Array.isArray(a.area) || a.area.length < 3 || a.area.length > LIMITES.verticesArea ||
        !a.area.every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) {
      return { ok: false, motivo: `${nomeParte}: a área precisa de 3 a ${LIMITES.verticesArea} pontos válidos` };
    }
    const t = a.t as Partial<Transform> | undefined;
    if (!t || !fin(t.offsetLesteM) || !fin(t.offsetNorteM) || !fin(t.rotacaoGraus)) return { ok: false, motivo: `${nomeParte} sem deslocamento válido` };
    if (Math.abs(t.offsetLesteM!) > LIMITES.parteOffset || Math.abs(t.offsetNorteM!) > LIMITES.parteOffset) {
      return { ok: false, motivo: `${nomeParte}: deslocamento acima de ${LIMITES.parteOffset} m` };
    }
    if (Math.abs(t.rotacaoGraus!) > LIMITES.rotacao) return { ok: false, motivo: `${nomeParte}: giro acima de ${LIMITES.rotacao}°` };
    ajustes.push({
      id: a.id,
      nome: (typeof a.nome === "string" && a.nome.trim() ? a.nome.trim() : nomeParte).slice(0, 60),
      area: a.area.map((p) => [Number(p[0]), Number(p[1])] as [number, number]),
      t: {
        offsetLesteM: Math.round(t.offsetLesteM! * 100) / 100,
        offsetNorteM: Math.round(t.offsetNorteM! * 100) / 100,
        rotacaoGraus: Math.round(t.rotacaoGraus! * 1e4) / 1e4,
        escala: 1, // parte é rígida: o lote mantém a área medida
      },
    });
  }
  for (let i = 0; i < ajustes.length; i++) {
    for (let j = i + 1; j < ajustes.length; j++) {
      if (areasSeSobrepoem(ajustes[i].area, ajustes[j].area)) {
        return { ok: false, motivo: `as áreas de "${ajustes[i].nome}" e "${ajustes[j].nome}" se sobrepõem` };
      }
    }
  }
  return { ok: true, ajustes };
}

const vetor = (m: Matriz) => [m.a, m.b, m.d, m.e, m.xoff, m.yoff];
const ehIdentidadeM = (m: Matriz) =>
  Math.abs(m.a - 1) < 1e-12 && Math.abs(m.e - 1) < 1e-12 && Math.abs(m.b) < 1e-12 && Math.abs(m.d) < 1e-12 &&
  Math.abs(m.xoff) < 1e-12 && Math.abs(m.yoff) < 1e-12;

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
    .select("nome, tipo, tiles_path, publico_path, publico_centro, offset_leste_m, offset_norte_m, rotacao_graus, escala, layers_ocultos, ajustes_locais, edicoes_geometria, lotes_total, lotes_assinatura")
    .eq("id", id).single();
  if (!antes) {
    return falha(404, "camada_sumiu", "Essa camada não existe mais.", {
      motivo: "Ela pode ter sido removida ou substituída por um envio novo enquanto a tela estava aberta.",
      solucao: "Feche a calibração e recarregue a lista de camadas.",
    });
  }

  const { error } = await admin.from("cartography_layers").update(patch).eq("id", id);
  if (error) return falhaBanco("calibracao_nao_gravou", error);

  // seleção de camadas mudou → regrava o arquivo que o mapa público baixa.
  // A calibração já está salva; se isto falhar, o mapa segue filtrando no
  // navegador como antes, só mais pesado — por isso vira aviso, não erro.
  let publico: Awaited<ReturnType<typeof gerarPlantaPublica>> | null = null;
  let avisoPublico: string | null = null;
  const mudouCamadas = Array.isArray(patch.layers_ocultos) &&
    [...(patch.layers_ocultos as string[])].sort().join("|") !== [...((antes.layers_ocultos as string[] | null) ?? [])].sort().join("|");
  const mudouGeometria = patch.edicoes_geometria !== undefined &&
    JSON.stringify(patch.edicoes_geometria) !== JSON.stringify(antes.edicoes_geometria ?? []);
  if ((mudouCamadas || mudouGeometria) && antes.tipo === "vector" && antes.tiles_path) {
    try {
      publico = await gerarPlantaPublica(
        admin, { id, tiles_path: antes.tiles_path, publico_path: antes.publico_path },
        (patch.layers_ocultos as string[] | undefined) ?? ((antes.layers_ocultos as string[] | null) ?? []),
        (patch.edicoes_geometria as EdicaoGeometria[] | undefined) ?? ((antes.edicoes_geometria as EdicaoGeometria[] | null) ?? [])
      );
    } catch (e) {
      avisoPublico = e instanceof Error ? e.message : String(e);
    }
  }

  // mexeu na posição da planta inteira ou nas camadas: os lotes clicáveis
  // precisam ser refeitos para continuar em cima das linhas que o usuário vê.
  // A tela manda todos os campos a cada salvamento, então a comparação é com o
  // que estava gravado — antes, salvar só uma parte refazia a cidade inteira.
  const difere = (novo: unknown, velho: unknown, tol: number) =>
    novo !== undefined && Math.abs(Number(novo) - Number(velho ?? 0)) > tol;
  const camadasAntes = [...((antes.layers_ocultos as string[] | null) ?? [])].sort().join("|");
  const mexeuNaPlanta =
    difere(patch.offset_leste_m, antes.offset_leste_m, 0.005) || difere(patch.offset_norte_m, antes.offset_norte_m, 0.005) ||
    difere(patch.rotacao_graus, antes.rotacao_graus, 1e-5) || (patch.escala !== undefined && Math.abs(Number(patch.escala) - Number(antes.escala ?? 1)) > 1e-7) ||
    (Array.isArray(patch.layers_ocultos) && [...(patch.layers_ocultos as string[])].sort().join("|") !== camadasAntes) || mudouGeometria;

  const ajustesAntes = ((antes.ajustes_locais as AjusteLocal[] | null) ?? []);
  const ajustesDepois = (patch.ajustes_locais as AjusteLocal[] | undefined) ?? ajustesAntes;
  const mexeuNasPartes = JSON.stringify(ajustesAntes) !== JSON.stringify(ajustesDepois);

  let lotesMovidos: number | null = null;
  let avisoLotes: string | null = null;
  if (antes.tipo === "vector" && (mexeuNaPlanta || (mexeuNasPartes && !antes.lotes_total))) {
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
      .eq("tipo", "gerar_lotes").eq("status", "pendente").contains("payload", { layer_id: id });
    if (!count) await admin.from("jobs").insert({ tipo: "gerar_lotes", payload: { layer_id: id } });
  } else if (antes.tipo === "vector" && mexeuNasPartes) {
    // só as partes mudaram: os lotes delas andam junto, no lugar, e mantêm a
    // numeração de quadra e lote (refazer a cidade apagaria a numeração)
    try {
      lotesMovidos = await moverLotesDasPartes(admin, id, antes, ajustesAntes, ajustesDepois);
      // os lotes andaram no lugar (mesmo id): os anúncios deles andam junto
      if (lotesMovidos) await admin.rpc("fn_reencaixar_anuncios", { p_layer_id: id, p_user_id: a.userId });
    } catch (e) {
      avisoLotes = e instanceof Error ? e.message : String(e);
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
    aviso_publico: avisoPublico,
    lotes_movidos: lotesMovidos,
    aviso_lotes: avisoLotes,
  });
}

/**
 * Move os lotes clicáveis de cada parte que mudou: da posição gravada
 * (planta ∘ parte antiga) para a nova (planta ∘ parte nova), pelo banco
 * (fn_ajustar_lotes_parte). Depois carimba a assinatura e a data dos lotes,
 * para o mapa pedir os tiles novos — mas só se os lotes estavam em dia; se já
 * estavam defasados, continuam marcados como defasados.
 */
async function moverLotesDasPartes(
  admin: ReturnType<typeof supabaseAdmin>,
  id: string,
  antes: Record<string, unknown>,
  velhos: AjusteLocal[],
  novos: AjusteLocal[],
): Promise<number> {
  let centro = Array.isArray(antes.publico_centro) && antes.publico_centro.length === 2
    ? (antes.publico_centro as [number, number]) : null;
  if (!centro) {
    const { data } = admin.storage.from("media").getPublicUrl(String(antes.tiles_path));
    const fc = await fetch(data.publicUrl).then((r) => r.json()).catch(() => null);
    if (!fc?.features) throw new Error("não consegui ler a planta para achar o centro da calibração");
    centro = centroDe(fc);
  }
  const g = afim(centro, {
    offsetLesteM: Number(antes.offset_leste_m ?? 0), offsetNorteM: Number(antes.offset_norte_m ?? 0),
    rotacaoGraus: Number(antes.rotacao_graus ?? 0), escala: Number(antes.escala ?? 1) || 1,
  });
  const local = (a: AjusteLocal | undefined, area: [number, number][]) => afim(centroArea(area), a?.t ?? TRANSFORM_ZERO);

  const porId = new Map<string, { velho?: AjusteLocal; novo?: AjusteLocal }>();
  for (const a of velhos) porId.set(a.id, { velho: a });
  for (const a of novos) porId.set(a.id, { ...porId.get(a.id), novo: a });

  let total = 0;
  for (const { velho, novo } of porId.values()) {
    // mesmo id com contorno diferente: tira a parte velha e põe a nova
    const passos = velho && novo && JSON.stringify(velho.area) !== JSON.stringify(novo.area)
      ? [{ area: velho.area, de: velho, para: undefined }, { area: novo.area, de: undefined, para: novo }]
      : [{ area: (novo ?? velho)!.area, de: velho, para: novo }];
    for (const p of passos) {
      const atual = compor(g, local(p.de, p.area));
      const inv = inverter(atual);
      const delta = compor(compor(g, local(p.para, p.area)), inv);
      if (ehIdentidadeM(delta)) continue;
      const { data, error } = await admin.rpc("fn_ajustar_lotes_parte", {
        p_layer: id,
        p_area: { type: "Polygon", coordinates: [[...p.area, p.area[0]]] },
        p_inv: vetor(inv),
        p_delta: vetor(delta),
      });
      if (error) throw new Error(`os lotes não acompanharam a parte (${error.message})`);
      total += Number(data ?? 0);
    }
  }

  const assinatura = String(antes.lotes_assinatura ?? "");
  const sufixoVelho = assinaturaAjustes(velhos);
  const emDia = sufixoVelho ? assinatura.endsWith(sufixoVelho) : !assinatura.includes(";aj:");
  if (emDia && assinatura) {
    const base = sufixoVelho ? assinatura.slice(0, -sufixoVelho.length) : assinatura;
    await admin.from("cartography_layers")
      .update({ lotes_assinatura: base + assinaturaAjustes(novos), lotes_gerados_em: new Date().toISOString() })
      .eq("id", id);
  }
  return total;
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
