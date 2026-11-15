import { quadroDeTeste } from "./fixture-exclusividade.mjs";
// Teste da rodada 3 (01/10/2026): perfil de leiloeiro e imóvel de leilão,
// selfie obrigatória na exclusividade e envio de vídeo pelo anunciante.
// Tudo o que o teste cria é apagado no fim.
//
// Uso: node scripts/testa-perfis.mjs   (com `npm run dev` rodando)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EMAIL = "leiloeiro.teste@arinibrasil.com.br";
const SENHA = "LeilaoTeste2026x";
const ok = (rotulo, cond, extra = "") => console.log(`${cond ? "✓" : "✗"} ${rotulo}${extra ? " — " + extra : ""}`);

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1440,900"],
});
const nova = async () => {
  const p = await (await b.createBrowserContext()).newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`${BASE}/entrar`, { waitUntil: "networkidle2", timeout: 120000 });
  // trava do site (fase de testes)
  if (process.env.SITE_SENHA && p.url().includes("/acesso")) {
    await p.evaluate(async (senha) => {
      await fetch("/api/acesso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha }) });
    }, process.env.SITE_SENHA);
    await p.goto(`${BASE}/entrar`, { waitUntil: "networkidle2", timeout: 120000 });
  }
  return p;
};
const api = (p, url, body, method = "POST") => p.evaluate(async (u, bd, m) => {
  const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(bd ?? {}) });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch {}
  return { status: r.status, corpo: t.slice(0, 200), json };
}, url, body, method);

/** Cria um imóvel pela rota multipart, com arquivos de mentira montados no navegador. */
const { data: municipioQA } = await admin.from("municipalities").select("id").eq("codigo_ibge","3134400").single();
const anunciar = (p, dados, arquivos) => p.evaluate(async (d, arqs, quadro) => {
  const fd = new FormData();
  const regras = await (await fetch("/api/conta/anunciar")).json();
  if (d.prazo_exclusividade_meses) {
    Object.assign(d,quadro,{termo_exclusividade:regras.termos[d.prazo_exclusividade_meses]});
  }
  d.versao_aceita = d.condicao === "exclusividade" ? regras.versoes.exclusividade : regras.versoes.outros;
  fd.set("dados", JSON.stringify(d));
  fd.set("geometria", JSON.stringify({ fonte: "desenho", geometry: { type: "Polygon", coordinates: [[[-50.21, -19.73], [-50.209, -19.73], [-50.209, -19.729], [-50.21, -19.729], [-50.21, -19.73]]] } }));
  // conteúdo com a assinatura real do formato: o servidor confere os bytes, não o tipo declarado
  const amostra = (tipo) => {
    const b = new Uint8Array(2048);
    const cab = tipo === "application/pdf" ? [...new TextEncoder().encode("%PDF-1.4 ")]
      : tipo === "image/png" ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : tipo.startsWith("image/") ? [0xff, 0xd8, 0xff, 0xe0] : [];
    b.set(cab, 0);
    return b;
  };
  for (const [campo, nome, tipo] of arqs) fd.append(campo, new File([amostra(tipo)], nome, { type: tipo }));
  const r = await fetch("/api/imoveis", { method: "POST", body: fd });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch {}
  return { status: r.status, corpo: t.slice(0, 200), json };
}, dados, arquivos, quadroDeTeste(municipioQA?.id));

const imoveis = [];
let userId = null;
try {
  // ---------- leiloeiro ----------
  const { data: l0 } = await admin.auth.admin.listUsers({ perPage: 500 });
  const velho = l0.users.find((u) => u.email === EMAIL);
  if (velho) await admin.auth.admin.deleteUser(velho.id);

  const p = await nova();
  const versaoCadastro = await p.evaluate(async () => (await (await fetch("/api/conta/anunciar")).json()).versoes.cadastro);
  const cad = await api(p, "/api/cadastro", { versao_termos:versaoCadastro, email: EMAIL, senha: SENHA, nome: "Leiloeiro Teste", role: "leiloeiro", cpf: "11144477735", registro_profissional: "JUCEMG 0001", aceite_termos: true });
  ok("cadastro de leiloeiro", cad.status === 200, cad.corpo);
  const { data: l1 } = await admin.auth.admin.listUsers({ perPage: 500 });
  userId = l1.users.find((u) => u.email === EMAIL)?.id ?? null;
  const { data: parceiro } = await admin.from("partners").select("id, tipo, status, aceite_termos_versao").eq("profile_id", userId).single();
  ok("virou parceiro do tipo leiloeiro, aguardando aprovação", parceiro?.tipo === "leiloeiro" && parceiro?.status === "solicitado", JSON.stringify(parceiro));

  ok("login do leiloeiro", (await api(p, "/api/auth/entrar", { email: EMAIL, senha: SENHA })).status === 200);
  const semAprov = await anunciar(p, { tipo: "urbano", titulo: "TESTE leilão", aceite_termos: true, leilao: { praca1_data: "2026-11-10T10:00" } }, [["doc_edital", "edital.pdf", "application/pdf"]]);
  ok("leiloeiro não aprovado não anuncia (403)", semAprov.status === 403, semAprov.corpo);
  await admin.from("partners").update({ status: "ativo" }).eq("id", parceiro.id);

  const semEdital = await anunciar(p, { tipo: "urbano", titulo: "TESTE leilão", aceite_termos: true, leilao: { praca1_data: "2026-11-10T10:00" } }, []);
  ok("leilão sem edital é recusado", semEdital.status === 400 && /edital/i.test(semEdital.corpo), semEdital.corpo);

  const lei = await anunciar(p, {
    tipo: "urbano", titulo: "TESTE AUTOMATIZADO — casa em leilão", valor: 420000, aceite_termos: true,
    leilao: { praca1_data: "2026-11-10T10:00", praca1_lance: "420.000", praca2_data: "2026-11-24T10:00", praca2_lance: "252.000", comitente: "Banco Teste", site: "https://exemplo.com/leilao" },
  }, [["doc_edital", "edital.pdf", "application/pdf"]]);
  ok("leilão com edital é criado", lei.status === 200, lei.corpo);
  if (lei.json?.id) imoveis.push(lei.json.id);
  const { data: reg } = await admin.from("properties").select("modalidade, leilao, status").eq("id", lei.json?.id).single();
  ok("gravou modalidade e praças", reg?.modalidade === "leilao" && reg?.leilao?.praca1_lance === 420000 && reg?.leilao?.praca2_lance === 252000, JSON.stringify(reg));

  // ---------- vídeo ----------
  const video = await p.evaluate(async (id) => {
    const pedido = await fetch(`/api/imoveis/${id}/midia`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "video/mp4", tamanho: 4096 }) });
    const aut = await pedido.json();
    if (!pedido.ok) return { etapa: "pedido", ...aut };
    const up = await fetch(`${aut.url ?? ""}`, { method: "HEAD" }).catch(() => null);
    return { etapa: "ok", path: aut.path, token: !!aut.token, up: !!up };
  }, lei.json?.id);
  ok("autorização de envio de vídeo", video.etapa === "ok" && video.token, JSON.stringify(video));
  const grande = await api(p, `/api/imoveis/${lei.json?.id}/midia`, { tipo: "video/mp4", tamanho: 80 * 1024 * 1024 });
  ok("vídeo acima de 50 MB é recusado", grande.status === 400, grande.corpo);
  const formato = await api(p, `/api/imoveis/${lei.json?.id}/midia`, { tipo: "application/zip", tamanho: 1000 });
  ok("formato que não é vídeo é recusado", formato.status === 400, formato.corpo);
  // envio real pelo cliente do navegador (mesmo caminho da tela)
  await p.goto(`${BASE}/painel/imoveis/${lei.json?.id}`, { waitUntil: "networkidle2", timeout: 120000 });
  const entrada = await p.$("input[type=file][accept^='video']");
  ok("tela do imóvel tem o envio de vídeo", !!entrada);

  // ---------- análise: edital conferido ----------
  const a = await nova();
  await api(a, "/api/auth/entrar", { email: "admin@arinibrasil.com.br", senha: process.env.SEED_USER_PASSWORD });
  await api(a, "/api/admin/decisao", { alvo: "imovel", id: lei.json?.id, acao: "em_analise" });
  const cedo = await api(a, "/api/admin/decisao", { alvo: "imovel", id: lei.json?.id, acao: "aprovado" });
  ok("aprovar leilão sem edital conferido é recusado", cedo.status === 400 && /edital/i.test(cedo.corpo), cedo.corpo);
  const { data: doc } = await admin.from("property_documents").select("id").eq("property_id", lei.json?.id).eq("tipo", "edital").single();
  await api(a, `/api/imoveis/${lei.json?.id}/documentos`, { documento_id: doc.id, verificado: true }, "PATCH");
  ok("aprovar com edital conferido", (await api(a, "/api/admin/decisao", { alvo: "imovel", id: lei.json?.id, acao: "aprovado" })).status === 200);
  ok("publicar", (await api(a, "/api/admin/decisao", { alvo: "imovel", id: lei.json?.id, acao: "publicado" })).status === 200);
  const geo = await a.evaluate(async () => (await (await fetch("/api/geo/imoveis", { cache: "no-store" })).json()).features.map((f) => f.properties).find((x) => x.titulo.startsWith("TESTE AUTOMATIZADO")));
  ok("no mapa, o leilão sai com a cor de leilão", geo?.cor === "leilao" && geo?.modalidade === "leilao", JSON.stringify(geo ?? {}).slice(0, 120));
  await a.goto(`${BASE}/imovel/${geo?.codigo}`, { waitUntil: "networkidle2", timeout: 120000 });
  ok("página do imóvel mostra o bloco de leilão", await a.evaluate(() => /1ª praça/i.test(document.body.innerText) && /lance mínimo/i.test(document.body.innerText)));
  await a.screenshot({ path: ".capturas/imovel-leilao.png", fullPage: true });

  // ---------- selfie na exclusividade ----------
  const q = await nova();
  await api(q, "/api/auth/entrar", { email: "proprietario.teste@arinibrasil.com.br", senha: process.env.SEED_USER_PASSWORD });
  const semPrazo = await anunciar(q, { tipo:"rural", titulo:"TESTE prazo obrigatório", condicao:"exclusividade", aceite_termos:true }, []);
  ok("exclusividade exige prazo escolhido", semPrazo.status===400 && /180 dias ou 12/.test(semPrazo.corpo), semPrazo.corpo);
  const semSelfie = await anunciar(q, { tipo: "rural", titulo: "TESTE exclusividade", condicao: "exclusividade", prazo_exclusividade_meses: 12, aceite_termos: true }, [["doc_matricula", "matricula.pdf", "application/pdf"]]);
  ok("exclusividade sem selfie é recusada", semSelfie.status === 400 && /selfie/i.test(semSelfie.corpo), semSelfie.corpo);
  const { count: orfaos } = await admin.from("properties").select("id", { count: "exact", head: true }).eq("titulo", "TESTE exclusividade");
  ok("recusa não deixa imóvel órfão", orfaos === 0, String(orfaos));
  const comSelfie = await anunciar(q, { tipo: "rural", titulo: "TESTE AUTOMATIZADO — exclusividade", condicao: "exclusividade", prazo_exclusividade_meses: 12, aceite_termos: true },
    [["doc_matricula", "matricula.pdf", "application/pdf"], ["selfie", "selfie.jpg", "image/jpeg"]]);
  ok("exclusividade com selfie é criada", comSelfie.status === 200, comSelfie.corpo);
  if (comSelfie.json?.id) imoveis.push(comSelfie.json.id);
  const { data: aut } = await admin.from("property_authorizations").select("tipo, selfie_path, versao, prazo_meses, termo_aceito").eq("property_id", comSelfie.json?.id).single();
  ok("prazo e versão do texto aceito preservados", aut?.prazo_meses===12 && /12 meses/.test(JSON.stringify(aut?.termo_aceito)), aut?.versao);
  ok("selfie guardada junto do aceite", aut?.tipo === "exclusividade" && !!aut?.selfie_path, JSON.stringify(aut));
  const publica = await q.evaluate(async (path, base) => (await fetch(`${base}/storage/v1/object/public/docs/${path}`)).status, aut?.selfie_path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  ok("a selfie NÃO é acessível por endereço público", publica !== 200, String(publica));
} finally {
  for (const id of imoveis) {
    const { data: docs } = await admin.from("property_documents").select("storage_path").eq("property_id", id);
    const { data: auts } = await admin.from("property_authorizations").select("selfie_path").eq("property_id", id);
    const caminhos = [...(docs ?? []).map((d) => d.storage_path), ...(auts ?? []).map((x) => x.selfie_path).filter(Boolean)];
    if (caminhos.length) await admin.storage.from("docs").remove(caminhos);
    await admin.from("presentations").delete().eq("property_id", id);
    await admin.from("subscriptions").delete().eq("property_id", id);
    await admin.from("jobs").delete().contains("payload", { property_id: id });
    await admin.from("properties").delete().eq("id", id);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
  const { data: resto } = await admin.from("properties").select("codigo").like("titulo", "TESTE%");
  console.log("limpeza feita; imóveis de teste restantes:", resto?.length ?? 0);
  await b.close();
}
