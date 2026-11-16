import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { oportunidadesDoEspelho, projetarAtendimento } = createJiti(import.meta.url)("../src/lib/empreendimento/privacidade.ts");
const base = { codigo:"OP-1", etapa:"visita", property_id:"lote-1", responsavel_tipo:"parceiro", partner_comprador_id:null };
const oportunidades = [
  { ...base, id:"atribuida", responsavel_partner_id:"A", lead:{nome:"Cliente da atribuída"} },
  { ...base, id:"comprador", responsavel_partner_id:"B", partner_comprador_id:"A", lead:{nome:"Cliente apresentado"} },
  { ...base, id:"outro", responsavel_partner_id:"B", lead:{nome:"Cliente de B"} },
  { ...base, id:"reatribuida", responsavel_tipo:"arini", responsavel_partner_id:"A", lead:{nome:"Agora na Central"} },
  { ...base, id:"de-outro-lote", property_id:"lote-2", responsavel_partner_id:"A", lead:{nome:"Outro lote"} },
];
const privados = ["Nome copiado de reserva on-line", "Nota livre de atendimento", "Autor anterior"];
const nulo = { cliente:null, oportunidade:null, nota:null, autor:null };

test("corretor só recebe oportunidades designadas ao próprio parceiro e lote", () => {
  const lote = oportunidadesDoEspelho(oportunidades, false, "A").get("lote-1");
  assert.deepEqual(lote.map(o=>o.id), ["atribuida", "comprador"]);
  for (const id of ["outro", "reatribuida", "de-outro-lote", null]) {
    assert.deepEqual(projetarAtendimento(false, lote, id, ...privados), nulo);
  }
  assert.deepEqual(projetarAtendimento(false, lote, "atribuida", ...privados), {
    cliente:"Cliente da atribuída", oportunidade:"atribuida", nota:null, autor:null,
  });
  assert.equal(projetarAtendimento(false, lote, "comprador", ...privados).cliente,"Cliente apresentado");
});

test("proprietário não recebe dados de atendimento, inclusive dos históricos", () => {
  const lote = oportunidadesDoEspelho(oportunidades, false, null).get("lote-1");
  assert.equal(lote, undefined);
  assert.deepEqual(projetarAtendimento(false, lote, "atribuida", ...privados), nulo);
  assert.deepEqual(projetarAtendimento(false, lote, null, ...privados), nulo);
});

test("Comercial preserva a gestão da reserva e a autoria do atendimento", () => {
  const lote = oportunidadesDoEspelho(oportunidades, true, null).get("lote-1");
  assert.equal(lote.length, 4);
  assert.deepEqual(projetarAtendimento(true, lote, null, ...privados), {
    cliente:privados[0], oportunidade:null, nota:privados[1], autor:privados[2],
  });
});

test("a resposta do espelho oculta identidade da reserva online e eventos de outras oportunidades", async t => {
  const url = "https://espelho.test.invalid";
  const antes = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "apenas-fixture";
  t.after(() => {
    [ "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY" ].forEach((k,i) => {
      if (antes[i] === undefined) delete process.env[k];
      else process.env[k] = antes[i];
    });
  });
  const eventos = [null, "outro", "atribuida"].map((opportunity_id,i) => ({
    id:"evt-"+i, property_id:"lote-1", opportunity_id, de:"disponivel", para:"reservado",
    cliente_nome:privados[0], motivo:privados[1], autor:privados[2], created_at:"2026-01-02",
  }));
  const consultas = [];
  t.mock.method(globalThis, "fetch", async input => {
    const request = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    assert.equal(request.origin,url);
    consultas.push(request);
    const tabela = request.pathname.split("/").at(-1);
    const resposta = {
      properties:[{ id:"lote-1",titulo:"Unidade",status:"publicado" }],
      fn_espelho_geometrias:{type:"FeatureCollection",features:[{type:"Feature",properties:{id:"lote-1"},
        geometry:{type:"Point",coordinates:[-50,-20]}}]},
      fn_espelho_liberar_vencidas:0,
      property_espelho:[{ property_id:"lote-1", status:"reservado", reserva_ate:"2099-01-02",
        cliente_nome:privados[0], observacao:privados[1], alterado_por:privados[2], opportunity_id:null }],
      opportunities:oportunidades,
      property_espelho_eventos:eventos,
    };
    assert(Object.hasOwn(resposta,tabela), "Consulta inesperada: "+tabela);
    return Response.json(resposta[tabela]);
  });
  const jiti = createJiti(import.meta.url, { alias:{
    "@":fileURLToPath(new URL("../src",import.meta.url)),
    "server-only":fileURLToPath(new URL("../node_modules/server-only/empty.js",import.meta.url)),
  } });
  const { carregarEspelhoGestao } = jiti("../src/lib/empreendimento/espelho.ts");
  const emp = { id:"empreendimento", partner_id:"A", owner_id:"dono" };
  await assert.rejects(carregarEspelhoGestao(emp,null), /Sem acesso/);
  const dados = await carregarEspelhoGestao(emp,{ ehArini:false, parceiroAtivo:true, partnerId:"A", ownerId:null });
  const [u] = dados.unidades;
  assert.equal(dados.geometrias.features[0].properties.id,"lote-1");
  assert.equal(u.status,"reservado");
  assert.equal(u.cliente_nome,null);
  assert.equal(u.observacao,null);
  assert.equal(u.alterado_por,null);
  assert.deepEqual(u.eventos.map(e=>e.cliente_nome),[null,null,"Cliente da atribuída"]);
  const json = JSON.stringify(dados);
  for (const bloqueado of [...privados,"Cliente de B","Agora na Central",'"outro"']) assert(!json.includes(bloqueado));
  assert(consultas.find(r=>r.pathname.endsWith("/opportunities")).searchParams.get("or").includes("partner_comprador_id.eq.A"));
  assert(!consultas.some(r=>r.pathname.endsWith("/profiles")));
});

const urlBanco = process.env.ARINI_TESTE_CARTEIRA_DB;
const bancoLocal = urlBanco && ["127.0.0.1","localhost","[::1]"].includes(new URL(urlBanco).hostname);

test("o mapa público omite somente o pré-lançamento e volta a mostrar as unidades liberadas", {skip:!bancoLocal}, async () => {
  const host = new pg.Client({connectionString:urlBanco});
  await host.connect();
  const nome = "arini_teste_mapa_" + randomUUID().replaceAll("-","");
  const url = new URL(urlBanco);
  url.pathname = "/" + nome;
  const db = new pg.Client({connectionString:url.href});
  try {
    await host.query("create database " + nome);
    await db.connect();
    // O teste isola o filtro relacional da instalação do PostGIS.
    await db.query(`
      create table properties(id int, parent_property_id int, codigo text, titulo text, tipo text,
        status text, valor numeric, modalidade text, municipality_id int);
      create table property_geometries(property_id int, geom jsonb, area_m2 numeric, centroid point);
      create table municipalities(id int, nome text);
      create table property_media(property_id int, tipo text, capa boolean, ordem int, storage_path text);
      create table espelho_config(empreendimento_id int primary key, pre_lancamento boolean not null);
      create function st_asgeojson(jsonb,int) returns text language sql as 'select $1::text';
      create function st_x(point) returns float8 language sql as 'select $1[0]';
      create function st_y(point) returns float8 language sql as 'select $1[1]';
      insert into properties(id,parent_property_id,status) values
        (1,null,'publicado'),(2,1,'em_negociacao'),(3,1,'rascunho'),
        (4,null,'publicado'),(5,null,'publicado'),(6,5,'publicado');
      insert into property_geometries(property_id,geom,centroid)
        select id,'{"type":"Point","coordinates":[-50,-20]}',point(-50,-20) from properties;
      insert into espelho_config values(1,true),(5,false);`);
    await db.query(await readFile(new URL("../supabase/migrations/0140_pre_lancamento_mapa.sql",import.meta.url),"utf8"));
    const idsDoMapa = async () => {
      const {rows} = await db.query("select fn_properties_geojson() as mapa");
      return rows[0].mapa.features.map(f => f.properties.id).sort((a,b) => a-b);
    };
    assert.deepEqual(await idsDoMapa(),[4,5,6]);
    assert.equal((await db.query("select geom from property_geometries where property_id=2")).rowCount,1);
    await db.query("update espelho_config set pre_lancamento=false where empreendimento_id=1");
    assert.deepEqual(await idsDoMapa(),[1,2,4,5,6]);
  } finally {
    await db.end();
    try { await host.query("drop database if exists " + nome); } finally { await host.end(); }
  }
});
