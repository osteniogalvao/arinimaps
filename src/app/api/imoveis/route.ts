import { NextResponse } from "next/server";
import { ator, temSetor } from "@/lib/authz";
import { conferirRecurso, registrarTentativa, respostaNegacao } from "@/lib/planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { assinatura, ipDe } from "@/lib/juridico";
import { ehParceiro } from "@/lib/perfis";
import { registrarOrigemDado } from "@/lib/imovel/eventos";
import { ACEITA, conferirArquivo, type ArquivoConferido } from "@/lib/seguranca/arquivos";
import { LOTES_MAX } from "@/lib/geo/loteamento";
import { validarCampoTour } from "@/lib/imovel/tour";

// Cria imóvel (multipart): dados + geometria GeoJSON + fotos.
// Proprietário/parceiro precisa estar aprovado/ativo; Arini também pode cadastrar.
export async function POST(request: Request) {
  const conta = await ator();
  if (!conta) return NextResponse.json({ error: "Entre e confirme sua sessão para anunciar." }, { status: 401 });
  const user = { id: conta.userId, role: conta.role };
  if (conta.ehArini && !temSetor(conta, "operacoes", "comercial")) {
    return NextResponse.json({ error: "O cadastro de anúncios da Central exige o setor de Operações ou Comercial." }, { status: 403 });
  }
  const { negacao } = await conferirRecurso(request, user, "anunciar", { acesso: conta.acesso });
  if (negacao) return respostaNegacao(negacao);
  const admin = supabaseAdmin();

  // resolve o responsável pelo imóvel
  let owner_id: string | null = null;
  let partner_id: string | null = null;
  if (conta.role === "proprietario") {
    // Proprietário pode enviar o imóvel com a conta ainda em análise (fluxo do
    // Carlos, 24/09/2026: clica na área, cadastra, manda os documentos). O
    // imóvel só publica depois que a Arini confere a matrícula — é ali que a
    // propriedade é comprovada. Conta recusada ou suspensa não anuncia.
    const { data } = await admin.from("owners").select("id, status").eq("profile_id", user.id).single();
    if (!data || !["solicitado", "em_analise", "pendente", "aprovado", "ativo"].includes(data.status)) {
      return NextResponse.json(
        { error: "Seu cadastro de proprietário não está liberado para anunciar. Fale com a Arini." },
        { status: 403 }
      );
    }
    owner_id = data.id;
  } else if (ehParceiro(conta.role)) {
    const { data } = await admin.from("partners").select("id, status").eq("profile_id", user.id).single();
    if (!data || !["aprovado", "ativo"].includes(data.status)) {
      return NextResponse.json(
        { error: "Seu cadastro de parceiro ainda está em análise pela Arini." },
        { status: 403 }
      );
    }
    partner_id = data.id;
  } else if (!conta.ehArini) {
    return NextResponse.json({ error: "Este perfil não cadastra imóveis." }, { status: 403 });
  }

  const form = await request.formData();
  const dados = JSON.parse(String(form.get("dados") ?? "{}"));
  const geometria = JSON.parse(String(form.get("geometria") ?? "null"));
  const fotos = form.getAll("fotos").filter((f): f is File => f instanceof File);
  const TIPOS_DOC = ["matricula", "edital", "ccir_itr", "autorizacao", "outro"] as const;
  const docs = TIPOS_DOC.flatMap((tipo) =>
    form.getAll(`doc_${tipo}`).filter((f): f is File => f instanceof File && f.size > 0).map((arquivo) => ({ tipo, arquivo }))
  );

  if (!dados.titulo?.trim() || !dados.tipo || !geometria) {
    return NextResponse.json(
      { error: "Título, tipo e localização no mapa são obrigatórios." },
      { status: 400 }
    );
  }

  // condição de comercialização (spec item 8): parceiro é sempre "parceiro";
  // proprietário vende só com exclusividade (revisão do Carlos, 29/10: saiu a
  // autorização sem exclusividade) e aceita o termo.
  // A equipe Arini cadastra sem aceite eletrônico (contrato assinado vai em Documentos)
  // e ainda pode registrar uma autorização simples.
  const equipe = conta.ehArini;
  const condicao: "autorizacao" | "exclusividade" | "parceiro" = partner_id
    ? "parceiro"
    : equipe && dados.condicao !== "exclusividade" ? "autorizacao" : "exclusividade";
  // Leilão: só leiloeiro ou a equipe cadastram; o documento que sustenta o
  // anúncio é o edital, não a autorização do proprietário.
  const modalidade: "venda" | "leilao" =
    conta.role === "leiloeiro" || (equipe && dados.modalidade === "leilao") ? "leilao" : "venda";
  const txt = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const dinheiro = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const leilao = modalidade === "leilao" ? {
    praca1_data: txt(dados.leilao?.praca1_data, 40), praca1_lance: dinheiro(dados.leilao?.praca1_lance),
    praca2_data: txt(dados.leilao?.praca2_data, 40), praca2_lance: dinheiro(dados.leilao?.praca2_lance),
    processo: txt(dados.leilao?.processo), comitente: txt(dados.leilao?.comitente),
    site: /^https?:\/\//i.test(String(dados.leilao?.site ?? "")) ? txt(dados.leilao?.site, 500) : null,
    condicoes: txt(dados.leilao?.condicoes, 2000),
  } : {};
  if (modalidade === "leilao" && !equipe) {
    if (!docs.some((d) => d.tipo === "edital")) {
      return NextResponse.json({ error: "Envie o edital do leilão." }, { status: 400 });
    }
    if (!(leilao as { praca1_data?: string | null }).praca1_data) {
      return NextResponse.json({ error: "Informe a data da 1ª praça do leilão." }, { status: 400 });
    }
  }

  // comprovação de propriedade: sem matrícula não entra (a equipe Arini anexa depois)
  if (!equipe && modalidade === "venda" && !docs.some((d) => d.tipo === "matricula")) {
    return NextResponse.json(
      { error: "Envie a matrícula do imóvel (ou escritura/contrato registrado) para comprovar a propriedade." },
      { status: 400 }
    );
  }
  if (partner_id && modalidade === "venda" && !docs.some((d) => d.tipo === "autorizacao")) {
    return NextResponse.json(
      { error: "Imóvel de parceiro: envie a autorização de venda assinada pelo proprietário." },
      { status: 400 }
    );
  }
  const docGrande = docs.find((d) => d.arquivo.size > 25 * 1024 * 1024);
  if (docGrande) {
    return NextResponse.json({ error: `O arquivo ${docGrande.arquivo.name} passa de 25 MB.` }, { status: 400 });
  }
  // conteúdo conferido pelos primeiros bytes (item 6.2): página ou script
  // renomeado para .jpg/.pdf não entra, e o tipo gravado é o real
  const fotosOk: ArquivoConferido[] = [];
  for (const foto of fotos.slice(0, 20)) {
    const c = await conferirArquivo(foto, ACEITA.imagem, 20 * 1024 * 1024);
    if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 400 });
    fotosOk.push(c.arquivo);
  }
  const docsOk: { tipo: string; nome: string; arquivo: ArquivoConferido }[] = [];
  for (const { tipo, arquivo } of docs.slice(0, 30)) {
    const c = await conferirArquivo(arquivo, ACEITA.documento, 25 * 1024 * 1024);
    if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 400 });
    docsOk.push({ tipo, nome: arquivo.name, arquivo: c.arquivo });
  }

  // área do CAR: a divisa vem do NOSSO banco, não do navegador — quem manda o
  // código não consegue trocar a geometria no caminho
  let carCodigo: string | null = null;
  let geometriaFinal = geometria;
  // lote de onde veio a divisa: é o que reencaixa o anúncio quando a planta
  // oficial substituir a atual (migration 0053, fn_reencaixar_anuncios)
  let loteRef: LoteRef | null = null;
  // vários lotes de uma vez (loteamento): vira empreendimento + uma unidade por lote
  let unidades: { lote: LoteRef; geometry: GeoJSON.Polygon; valor: number | null; matricula: string | null }[] = [];
  if (Array.isArray(dados.lotes) && dados.lotes.length > 0) {
    const pedidos = (dados.lotes as { id?: unknown; valor?: unknown; matricula_numero?: unknown }[])
      .filter((l) => /^[0-9a-f-]{36}$/i.test(String(l?.id ?? "")));
    const ids = [...new Set(pedidos.map((l) => String(l.id)))];
    if (dados.tipo !== "urbano" || !ids.length || ids.length !== dados.lotes.length) {
      return NextResponse.json({ error: "Seleção de lotes inválida. Selecione os lotes de novo no mapa." }, { status: 400 });
    }
    if (ids.length > LOTES_MAX) {
      return NextResponse.json({ error: `No máximo ${LOTES_MAX} lotes por envio. Divida o loteamento em partes.` }, { status: 400 });
    }
    const { data: fc } = await admin.rpc("fn_lotes_por_ids", { p_ids: ids });
    const achados = (fc ?? []) as { geometry: GeoJSON.Polygon; properties: LoteRef & { anuncio: string | null } }[];
    if (achados.length !== ids.length) {
      return NextResponse.json({ error: "Algum lote não existe mais na planta. Selecione os lotes de novo no mapa." }, { status: 400 });
    }
    const ocupados = achados.filter((f) => f.properties.anuncio);
    if (ocupados.length) {
      return NextResponse.json({
        error: `${ocupados.length === 1 ? "Um lote já tem anúncio" : `${ocupados.length} lotes já têm anúncio`} (${[...new Set(ocupados.map((f) => f.properties.anuncio))].join(", ")}). Tire-os da seleção.`,
      }, { status: 400 });
    }
    if (new Set(achados.map((f) => f.properties.municipality_id)).size > 1) {
      return NextResponse.json({ error: "Os lotes precisam ser do mesmo município." }, { status: 400 });
    }
    const porId = new Map(pedidos.map((l) => [String(l.id), l]));
    unidades = achados.map((f) => ({
      lote: f.properties,
      geometry: f.geometry,
      valor: dinheiro(porId.get(f.properties.id)?.valor),
      matricula: txt(porId.get(f.properties.id)?.matricula_numero, 120),
    }));
    // a divisa do empreendimento é a soma dos lotes (o reencaixe a refaz a cada planta nova)
    geometriaFinal = {
      geometry: { type: "MultiPolygon", coordinates: unidades.map((u) => u.geometry.coordinates) },
      fonte: "lote",
    };
  } else if (geometria?.fonte === "car" && dados.car_codigo) {
    const { data: car } = await admin.rpc("fn_car_imovel", { p_cod: String(dados.car_codigo) });
    if (!car?.geometry) {
      return NextResponse.json({ error: "Área do CAR não encontrada. Clique de novo na área no mapa." }, { status: 400 });
    }
    carCodigo = String(dados.car_codigo);
    geometriaFinal = { geometry: car.geometry, fonte: "car" };
  } else if (geometria?.fonte === "lote" && /^[0-9a-f-]{36}$/i.test(String(dados.lote_id ?? ""))) {
    // lote urbano: mesma regra do CAR — a divisa é a do nosso banco
    const { data: lote } = await admin.rpc("fn_lote", { p_id: String(dados.lote_id) });
    if (!lote?.geometry) {
      return NextResponse.json({ error: "Lote não encontrado. Clique de novo no lote no mapa." }, { status: 400 });
    }
    geometriaFinal = { geometry: lote.geometry, fonte: "lote" };
    loteRef = lote.properties as LoteRef;
  } else if (geometria?.fonte === "car" || geometria?.fonte === "lote") {
    // "car" sem código não tem como ser conferido: vale como desenho comum
    geometriaFinal = { ...geometria, fonte: "desenho" };
  }

  // tour virtual 360 / vídeo imersivo (item 9): só links dos domínios aceitos
  const tour = validarCampoTour(dados.tour_virtual_url);
  if (!tour.ok) return NextResponse.json({ error: tour.erro }, { status: 400 });
  const caracteristicas = { ...((dados.caracteristicas ?? {}) as Record<string, unknown>) };
  delete caracteristicas.tour_virtual_url;
  if (tour.url) caracteristicas.tour_virtual_url = tour.url;

  if (!equipe && dados.aceite_termos !== true) {
    return NextResponse.json(
      { error: "Para anunciar é preciso aceitar o termo da condição de comercialização e a Regra de Remuneração." },
      { status: 400 }
    );
  }

  // unidade de empreendimento (bloco/loteamento): o anunciante informa o código do imóvel pai
  let parent_property_id: string | null = null;
  if (dados.parent_codigo?.trim()) {
    const { data: pai } = await admin
      .from("properties")
      .select("id, owner_id, partner_id")
      .eq("codigo", dados.parent_codigo.trim().toUpperCase())
      .maybeSingle();
    if (!pai) {
      return NextResponse.json({ error: "Código do empreendimento não encontrado." }, { status: 400 });
    }
    const mesmoDono =
      equipe ||
      (owner_id && pai.owner_id === owner_id) ||
      (partner_id && pai.partner_id === partner_id);
    if (!mesmoDono) {
      return NextResponse.json({ error: "O empreendimento informado não pertence a você." }, { status: 403 });
    }
    parent_property_id = pai.id;
  }

  const verificacao = await conferirRecurso(request, user, "anunciar", {
    acesso: conta.acesso, cota: "imoveis_ativos", quantidade: 1 + unidades.length,
  });
  if (verificacao.negacao) return respostaNegacao(verificacao.negacao);

  const { data: property, error: propError } = await admin
    .from("properties")
    .insert({
      tipo: dados.tipo,
      owner_id,
      partner_id,
      responsavel_central: equipe,
      titulo: dados.titulo.trim(),
      descricao: dados.descricao?.trim() || "",
      // empreendimento: o preço é de cada unidade; a área, a soma dos lotes
      valor: unidades.length ? null : dados.valor || null,
      area_declarada: unidades.length ? Math.round(unidades.reduce((s, u) => s + Number(u.lote.area_m2), 0)) : dados.area_declarada || null,
      caracteristicas,
      condicoes_venda: dados.condicoes_venda?.trim() || null,
      aceita_permuta: !!dados.aceita_permuta,
      aceita_financiamento: !!dados.aceita_financiamento,
      exclusividade: condicao === "exclusividade",
      parent_property_id,
      car_codigo: carCodigo,
      modalidade,
      leilao,
      created_by: user.id,
      ...camposDoLote(loteRef),
    })
    .select("id, codigo")
    .single();
  if (propError) return NextResponse.json({ error: propError.message }, { status: 500 });

  // número e cartório da matrícula (opcional; a Matriz confere com o documento).
  // Tabela só do servidor: o número não vai para o site público.
  const numeroMatricula = String(dados.matricula_numero ?? "").trim().slice(0, 120);
  if (numeroMatricula) {
    await admin.from("property_matriculas").insert({
      property_id: property.id,
      numero: numeroMatricula,
      cartorio: String(dados.matricula_cartorio ?? "").trim().slice(0, 200) || null,
    });
  }

  // aceite versionado: versão do termo, data/hora, usuário e IP
  const cfg = await lerConfiguracoes();
  const validade = new Date(Date.now() + numero(cfg, "juridico_prazo_autorizacao_dias", 180) * 86_400_000);
  const versao = condicao === "parceiro"
    ? assinatura("parceiros", "remuneracao")
    : condicao === "exclusividade"
      ? assinatura("autorizacao", "exclusividade", "remuneracao")
      : assinatura("autorizacao", "remuneracao");
  // Selfie no aceite da exclusividade (pedido do Carlos, 01/10/2026): foto de
  // identificação de quem aceitou, no cofre privado. Não há reconhecimento
  // facial — é evidência para conferência humana.
  let selfiePath: string | null = null;
  const selfie = form.get("selfie");
  const exigeSelfie = condicao === "exclusividade" && !equipe && cfg.juridico_selfie_exclusividade !== false;
  if (exigeSelfie) {
    const selfieOk = selfie instanceof File ? await conferirArquivo(selfie, ACEITA.imagem, 15 * 1024 * 1024) : null;
    if (!selfieOk?.ok) {
      await admin.from("properties").delete().eq("id", property.id);
      return NextResponse.json(
        { error: "Para a exclusividade, envie uma selfie (foto de até 15 MB) de quem está aceitando o termo." },
        { status: 400 }
      );
    }
    selfiePath = `imoveis/${property.id}/selfie-${crypto.randomUUID()}.${selfieOk.arquivo.ext}`;
    const { error: sErro } = await admin.storage.from("docs")
      .upload(selfiePath, selfieOk.arquivo.bytes, { contentType: selfieOk.arquivo.contentType });
    if (sErro) {
      await admin.from("properties").delete().eq("id", property.id);
      return NextResponse.json({ error: "A selfie não pôde ser salva. Tente de novo." }, { status: 502 });
    }
  }

  await admin.from("property_authorizations").insert({
    property_id: property.id,
    selfie_path: selfiePath,
    tipo: condicao,
    validade: validade.toISOString().slice(0, 10),
    aceite_at: equipe ? null : new Date().toISOString(),
    versao: equipe ? null : versao,
    aceite_por: equipe ? null : user.id,
    aceite_ip: equipe ? null : ipDe(request),
  });

  // geometria (fonte: desenho | kml | kmz | ponto | car | lote)
  // §1.5 origem do dado: CAR e lote vêm do nosso banco (fonte oficial); o
  // resto é geometria informada pelo usuário até a Matriz validar (§3).
  const fonteGeometria: string = geometriaFinal.fonte ?? "desenho";
  const origemGeometria = ["car", "lote"].includes(fonteGeometria) ? "fonte_oficial" : "geometria_usuario";
  const { error: geoError } = await admin.rpc("fn_upsert_geometry", {
    p_property_id: property.id,
    p_geojson: geometriaFinal.geometry ?? geometriaFinal,
    p_fonte: fonteGeometria,
    p_origem: origemGeometria,
    p_motivo: "Cadastro do imóvel",
    p_user_id: user.id,
  });
  if (geoError) {
    await admin.from("properties").delete().eq("id", property.id);
    if (selfiePath) await admin.storage.from("docs").remove([selfiePath]);
    return NextResponse.json({ error: `Geometria inválida: ${geoError.message}` }, { status: 400 });
  }
  await Promise.all([
    registrarOrigemDado({
      propertyId: property.id, campo: "cadastro", userId: user.id,
      origem: partner_id ? "corretor_franquia" : "proprietario",
      detalhe: equipe ? "Cadastrado pela equipe da Arini em nome do anunciante" : "Cadastro informado pelo anunciante",
    }),
    registrarOrigemDado({
      propertyId: property.id, campo: "geometria", userId: user.id, origem: origemGeometria,
      detalhe: fonteGeometria === "car"
        ? `Divisa trazida do CAR ${carCodigo ?? ""}`.trim()
        : fonteGeometria === "lote" ? "Divisa do lote da base cartográfica" : `Divisa informada pelo anunciante (${fonteGeometria})`,
    }),
  ]);

  // município por contenção espacial do centroide; select manual do usuário prevalece
  if (dados.municipality_id) {
    await admin.from("properties").update({ municipality_id: dados.municipality_id }).eq("id", property.id);
  } else {
    await admin.rpc("fn_set_property_municipality", { p_property_id: property.id });
  }

  // fotos → storage público
  let ordem = 0;
  const fotosSalvas: string[] = [];
  for (const foto of fotosOk) {
    const path = `properties/${property.id}/${crypto.randomUUID()}.${foto.ext}`;
    const { error: upError } = await admin.storage
      .from("media")
      .upload(path, foto.bytes, { contentType: foto.contentType });
    if (!upError) {
      fotosSalvas.push(path);
      await admin.from("property_media").insert({
        property_id: property.id,
        tipo: "foto",
        storage_path: path,
        ordem,
        capa: ordem === 0,
      });
      ordem++;
    }
  }

  // documentos de comprovação → bucket PRIVADO (docs), conferidos pela Arini
  const docsFalharam: string[] = [];
  const arquivosPrivados = selfiePath ? [selfiePath] : [];
  for (const { tipo, nome, arquivo } of docsOk) {
    const path = `imoveis/${property.id}/${tipo}-${crypto.randomUUID()}.${arquivo.ext}`;
    const { error: upErro } = await admin.storage.from("docs")
      .upload(path, arquivo.bytes, { contentType: arquivo.contentType });
    if (upErro) { docsFalharam.push(nome); continue; }
    arquivosPrivados.push(path);
    const { error: docErro } = await admin.from("property_documents").insert({
      property_id: property.id, tipo, storage_path: path, nome_arquivo: nome,
    });
    if (docErro) docsFalharam.push(nome);
  }
  if (!equipe && docsFalharam.length === docsOk.length) {
    // nenhum documento subiu: sem comprovação o imóvel não pode ir para análise
    await admin.from("properties").delete().eq("id", property.id);
    await Promise.all([
      arquivosPrivados.length && admin.storage.from("docs").remove(arquivosPrivados),
      fotosSalvas.length && admin.storage.from("media").remove(fotosSalvas),
    ]);
    return NextResponse.json(
      { error: "Os documentos não puderam ser salvos. Tente de novo em instantes." },
      { status: 502 }
    );
  }

  // Loteamento: o imóvel acima é o empreendimento; cada lote vira uma unidade
  // apontando para ele, com a divisa do próprio lote, o mesmo aceite e as
  // mesmas fotos (os arquivos não são copiados — as unidades apontam para os
  // do empreendimento). Matrícula e documentos ficam no empreendimento; a de
  // cada lote pode ser anexada depois na unidade.
  const criadas: string[] = [];
  const idsUnidades: string[] = [];
  for (const u of unidades) {
    const rotulo = [u.lote.quadra && `Quadra ${u.lote.quadra}`, u.lote.numero && `Lote ${u.lote.numero}`].filter(Boolean).join(" · ")
      || `Lote de ${Math.round(Number(u.lote.area_m2))} m²`;
    const { data: un, error: unErro } = await admin.from("properties").insert({
      tipo: "urbano", owner_id, partner_id, responsavel_central: equipe,
      titulo: `${dados.titulo.trim()} — ${rotulo}`.slice(0, 200),
      descricao: dados.descricao?.trim() || "",
      valor: u.valor ?? (dados.valor || null),
      area_declarada: Math.round(Number(u.lote.area_m2)),
      caracteristicas,
      condicoes_venda: dados.condicoes_venda?.trim() || null,
      aceita_permuta: !!dados.aceita_permuta,
      aceita_financiamento: !!dados.aceita_financiamento,
      exclusividade: condicao === "exclusividade",
      parent_property_id: property.id,
      municipality_id: u.lote.municipality_id,
      modalidade, leilao,
      created_by: user.id,
      ...camposDoLote(u.lote),
    }).select("id, codigo").single();
    if (unErro || !un) continue;
    const { error: gErro } = await admin.rpc("fn_upsert_geometry", {
      p_property_id: un.id, p_geojson: u.geometry, p_fonte: "lote", p_origem: "fonte_oficial",
      p_motivo: "Cadastro do loteamento", p_user_id: user.id,
    });
    if (gErro) { await admin.from("properties").delete().eq("id", un.id); continue; }
    await Promise.all([
      admin.from("property_authorizations").insert({
        property_id: un.id, selfie_path: selfiePath, tipo: condicao,
        validade: validade.toISOString().slice(0, 10),
        aceite_at: equipe ? null : new Date().toISOString(), versao: equipe ? null : versao,
        aceite_por: equipe ? null : user.id, aceite_ip: equipe ? null : ipDe(request),
      }),
      fotosSalvas.length
        ? admin.from("property_media").insert(fotosSalvas.map((storage_path, i) => ({
          property_id: un.id, tipo: "foto", storage_path, ordem: i, capa: i === 0,
        })))
        : Promise.resolve(),
      u.matricula ? admin.from("property_matriculas").insert({ property_id: un.id, numero: u.matricula }) : Promise.resolve(),
      registrarOrigemDado({
        propertyId: un.id, campo: "geometria", userId: user.id, origem: "fonte_oficial",
        detalhe: `Divisa do lote da base cartográfica (loteamento ${property.codigo})`,
      }),
    ]);
    idsUnidades.push(un.id);
    criadas.push(un.codigo);
  }
  // O banco revalida o plano e serializa o consumo da última vaga por conta.
  // A análise só recebe o loteamento depois de todos os rascunhos estarem preparados.
  const { error: envioErro } = await admin.rpc("fn_enviar_cadastro_imoveis", {
    p_criado_por: user.id, p_ids: [property.id, ...idsUnidades],
  });
  if (envioErro) {
    if (!envioErro.code) {
      return NextResponse.json({ error: `Confira o imóvel ${property.codigo} em Meus imóveis antes de reenviar. Não foi possível confirmar o envio.` }, { status: 503 });
    }
    if (idsUnidades.length) await admin.from("properties").delete().in("id", idsUnidades).eq("status", "rascunho");
    const { data: removido } = await admin.from("properties").delete().eq("id", property.id).eq("status", "rascunho").select("id");
    if (removido?.length) await Promise.all([
      arquivosPrivados.length && admin.storage.from("docs").remove(arquivosPrivados),
      fotosSalvas.length && admin.storage.from("media").remove(fotosSalvas),
    ]);
    const motivos: Record<string, string> = { P7501: "sem_plano", P7502: "cota_esgotada", P7503: "perfil_incompativel" };
    const motivo = motivos[envioErro.code];
    if (motivo) {
      await registrarTentativa({ request, userId: user.id, role: user.role, planId: conta.acesso.planId, recurso: "anunciar", motivo });
      return NextResponse.json({ error: envioErro.message, codigo: motivo }, { status: 403 });
    }
    return NextResponse.json({ error: "Não foi possível enviar o cadastro para análise. Tente novamente." }, { status: 503 });
  }

  await logAudit({
    user_id: user.id,
    acao: "imovel_cadastrado",
    entidade: "properties",
    entidade_id: property.id,
    property_id: property.id,
    dados_depois: {
      codigo: property.codigo, titulo: dados.titulo, condicao, aceite: equipe ? null : versao,
      car: carCodigo, documentos: docs.length - docsFalharam.length, documentos_falharam: docsFalharam,
      modalidade, selfie: !!selfiePath, lotes: unidades.length || undefined,
    },
  });

  if (unidades.length) {
    await logAudit({
      user_id: user.id, acao: "loteamento_cadastrado", entidade: "properties", entidade_id: property.id, property_id: property.id,
      dados_depois: { codigo: property.codigo, lotes: unidades.length, unidades: criadas },
    });
  }

  return NextResponse.json({
    ok: true, id: property.id, codigo: property.codigo, documentos_falharam: docsFalharam,
    ...(unidades.length ? { unidades: criadas.length, unidades_falharam: unidades.length - criadas.length } : {}),
  });
}

type LoteRef = { id: string; municipality_id: string | null; quadra: string | null; numero: string | null; area_m2: number };

const camposDoLote = (l: LoteRef | null) => l ? {
  lote_id: l.id, lote_municipality_id: l.municipality_id,
  lote_quadra: l.quadra ?? null, lote_numero: l.numero ?? null, lote_area_m2: l.area_m2,
} : {};
