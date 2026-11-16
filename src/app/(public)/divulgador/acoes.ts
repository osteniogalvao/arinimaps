"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { soDigitos, validarCNPJ } from "@/lib/br/documentos";
import { cifrar } from "@/lib/seguranca/cripto";
import { conferirArquivo } from "@/lib/seguranca/arquivos";
import { limitar } from "@/lib/seguranca/limite";

const painel = "/divulgador", central = "/admin/marketing/divulgadores";
const valor = (f: FormData, chave: string) => String(f.get(chave) ?? "").trim();
function mensagem(rota: string, texto: string): never {
  redirect(rota+"?aviso="+encodeURIComponent(texto));
}
function resposta(rota: string, erro: {code:string;message:string}|null, ok: string) {
  if(erro) mensagem(rota,erro.code==="P8601"?erro.message:erro.code==="23505"?"Este registro já está vinculado a outro cadastro.":"Não foi possível gravar. Atualize a página e tente novamente.");
  revalidatePath(painel);revalidatePath(central);revalidatePath("/conta/perfis");
  mensagem(rota,ok);
}
async function participante() {
  const a=await ator();
  if(!a) redirect("/entrar?volta=%2Fdivulgador");
  if(a.ehArini || a.role==="franqueado") mensagem(painel,"O piloto utiliza uma conta individual de participante.");
  return a;
}
async function operador() {
  const a=await ator();
  if(!a || !temSetor(a,"marketing")) redirect("/conta");
  return a;
}
export async function inscrever(form: FormData) {
  const a=await participante();
  const instagram=valor(form,"instagram").replace(/^@/,"").toLowerCase();
  const cnpj=soDigitos(valor(form,"cnpj"));
  const regiao=valor(form,"regiao");
  if((instagram||cnpj||regiao) && (!/^[a-z0-9._]{1,30}$/.test(instagram) || !validarCNPJ(cnpj) || regiao.length<2 || regiao.length>100))
    mensagem(painel,"Confira o perfil do Instagram, o CNPJ da empresa ou MEI e a região.");
  const {data,error}=await supabaseAdmin().rpc("divulgacao_inscrever",{
    p_titular:a.userId,p_instagram:instagram||null,p_cnpj:cnpj?(cifrar(cnpj)??cnpj):null,p_regiao:regiao||null,
  });
  resposta(painel,error,data==="espera"?"Interesse registrado. Você pode consultar a abertura das vagas nesta página.":"Sua inscrição foi registrada.");
}
export async function abrirPainel() {
  const a=await participante();
  const {error}=await supabaseAdmin().rpc("divulgacao_entrar",{p_titular:a.userId});
  resposta(painel,error,"Perfil de divulgador selecionado.");
}
export async function configurar(form: FormData) {
  const a=await operador();
  if(a.role!=="admin_central") redirect("/conta");
  const numeros=["participantes","imoveis","seguidores","atribuicao","revisao"].map(k=>Number(valor(form,k)));
  if(!numeros.every(n=>Number.isSafeInteger(n)&&n>=0) || numeros[0]>100000 || numeros[1]>100000 || numeros[2]>2147483647)
    mensagem(central,"Confira os limites do piloto.");
  const {error}=await supabaseAdmin().rpc("divulgacao_configurar",{p_ator:a.userId,p_aberto:form.has("aberto"),p_participantes:numeros[0],p_imoveis:numeros[1],p_seguidores:numeros[2],p_atribuicao:numeros[3],p_revisao:numeros[4]});
  resposta(central,error,"Configuração salva.");
}
export async function revisar(form: FormData) {
  const a=await operador(), estado=valor(form,"estado");
  if(form.get("operacao")==="reavaliar"&&valor(form,"motivo").length<3)mensagem(central,"Descreva a conferência realizada e o motivo da reavaliação.");
  if(estado==="ativo"&&!form.has("conferido")) mensagem(central,"Confirme a qualificação e os dados fiscais antes de aprovar.");
  const v=valor(form,"seguidores"), seguidores=v?Number(v):null;
  if(estado==="ativo" && (seguidores===null||!Number.isInteger(seguidores)||seguidores<0||seguidores>2147483647)) mensagem(central,"Informe a contagem de seguidores verificados.");
  const {error}=await supabaseAdmin().rpc("divulgacao_revisar",{p_ator:a.userId,p_titular:valor(form,"titular"),p_estado:estado,p_seguidores:seguidores,p_motivo:valor(form,"motivo")});
  resposta(central,error,"Decisão registrada.");
}

export async function autorizarImovel(form: FormData) {
  const a=await participante(), id=valor(form,"imovel");
  if(!/^[a-f\d-]{36}$/i.test(id)) redirect("/painel");
  const destino="/painel/imoveis/"+id;
  const {error}=await supabaseAdmin().rpc("divulgacao_autorizar",{p_ator:a.userId,p_imovel:id,p_autoriza:valor(form,"decisao")==="autorizar"});
  if(error) mensagem(painel,"A autorização exige a conta do proprietário vinculada ao imóvel.");
  revalidatePath(destino);revalidatePath(central);redirect(destino);
}

export async function salvarFaixa(form: FormData) {
  const a=await operador();if(a.role!=="admin_central") redirect("/conta");
  const [min,teto,simultaneos,dias]=["min","teto","simultaneos","dias"].map(k=>Number(valor(form,k).replace(",",".")));
  if(![min,simultaneos,dias].every(Number.isSafeInteger)||!Number.isFinite(teto)||teto<=0||min<0||simultaneos<1||dias<1) mensagem(central,"Confira os limites da faixa.");
  const {error}=await supabaseAdmin().rpc("divulgacao_faixa",{p_ator:a.userId,p_min:min,p_teto:teto,p_simultaneos:simultaneos,p_dias:dias});
  resposta(central,error,"Faixa salva.");
}

function linkHttps(texto: string, redes=false) {
  try {const url=new URL(texto);if(url.protocol!=="https:"||url.username||url.password||url.href.length>1800)return null;
    if(redes && !["instagram.com","facebook.com","fb.watch"].some(d=>url.hostname===d||url.hostname.endsWith("."+d))) return null;
    return url.href;
  }catch{return null;}
}

export async function salvarKit(form: FormData) {
  const a=await operador(), aprovar=valor(form,"decisao")==="aprovar", url=linkHttps(valor(form,"url"));
  const etapas=valor(form,"etapas").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(aprovar&&(!url||!form.has("revisado")||!etapas.length||etapas.length>12)) mensagem(central,"Confira os materiais, o link HTTPS e as etapas.");
  const {error}=await supabaseAdmin().rpc("divulgacao_kit",{p_ator:a.userId,p_imovel:valor(form,"imovel"),p_aprova:aprovar,
    p_titulo:valor(form,"titulo"),p_legenda:valor(form,"legenda"),p_url:url,p_etapas:etapas});
  resposta(central,error,aprovar?"Kit aprovado e catálogo atualizado.":"Imóvel retirado do catálogo.");
}
export async function reservar(form: FormData) {
  const a=await participante();const {error}=await supabaseAdmin().rpc("divulgacao_reservar",{p_titular:a.userId,p_imovel:valor(form,"imovel")});
  resposta(painel,error,"Reserva registrada.");
}
export async function publicarContrato(form: FormData) {
  const a=await operador();
  if(a.role!=="admin_central") redirect("/conta");
  const {error}=await supabaseAdmin().rpc("divulgacao_termo_publicar",{p_ator:a.userId,p_versao:valor(form,"versao"),p_texto:valor(form,"texto")});
  resposta(central,error,"Termo do programa publicado.");
}
export async function aceitarContrato(form: FormData) {
  const a=await participante();
  if(!form.has("li")) mensagem(painel,"Confirme a leitura para aceitar.");
  const {error}=await supabaseAdmin().rpc("divulgacao_aceitar",{p_titular:a.userId,p_termo:valor(form,"termo")});
  resposta(painel,error,"Aceite registrado.");
}
export async function entregar(form: FormData) {
  const a=await participante(), link=linkHttps(valor(form,"link"),true);
  if(!link) mensagem(painel,"Informe o link público da publicação no Instagram ou Facebook.");
  const arquivo=form.get("captura");
  if(!(arquivo instanceof File)||arquivo.size>800*1024) mensagem(painel,"Envie uma captura em JPEG, PNG ou WebP de até 800 KB após a redução.");
  const limite=await limitar("divulgacao-entrega:"+a.userId,30,3600);
  if(!limite.permitido) mensagem(painel,"O limite de envios desta hora foi atingido.");
  const imagem=await conferirArquivo(arquivo,["jpg","png","webp"],800*1024);
  if(!imagem.ok) mensagem(painel,imagem.erro);
  const {error}=await supabaseAdmin().rpc("divulgacao_entregar",{p_titular:a.userId,p_reserva:valor(form,"reserva"),p_etapa:Number(valor(form,"etapa")),p_link:link,
    p_captura:Buffer.from(imagem.arquivo.bytes).toString("base64"),p_mime:imagem.arquivo.contentType});
  resposta(painel,error,"Publicação enviada para conferência.");
}
export async function validarMissao(form: FormData) {
  const a=await operador();
  const {error}=await supabaseAdmin().rpc("divulgacao_validar",{p_ator:a.userId,p_missao:valor(form,"missao"),p_valida:valor(form,"decisao")==="validar",p_motivo:valor(form,"motivo")});
  resposta(central,error,"Revisão da publicação registrada.");
}

export async function ajustarFila(form: FormData) {
  const a=await operador();if(a.role!=="admin_central")redirect("/conta");
  const max=Number(valor(form,"max")), horas=valor(form,"horas");
  const {error}=await supabaseAdmin().rpc("divulgacao_parametros_fila",{p_ator:a.userId,p_max:max,p_horas:horas?Number(horas):null});
  resposta(central,error,"Fila atualizada.");
}
export async function filaImovel(form: FormData) {
  const a=await participante(), entrar=valor(form,"acao")==="entrar";
  const {error}=await supabaseAdmin().rpc("divulgacao_fila_mudar",{p_titular:a.userId,p_imovel:valor(form,"imovel"),p_entrar:entrar});
  resposta(painel,error,entrar?"Entrada na fila registrada.":"Você saiu da fila.");
}
export async function ajustarProgressao(form: FormData) {
  const a=await operador();if(a.role!=="admin_central")redirect("/conta");
  const min=(key:string)=>Number(valor(form,key));
  const {error}=await supabaseAdmin().rpc("divulgacao_progressao",{p_ator:a.userId,p_faixa:valor(form,"faixa"),p_ativa:form.has("ativa"),
    p_missoes:min("missoes"),p_cliques:min("cliques"),p_cadastros:min("cadastros"),p_visitas:min("visitas")});
  resposta(central,error,"Regra de progressão salva.");
}
export async function definirFaixa(form: FormData) {
  const a=await operador();
  const {error}=await supabaseAdmin().rpc("divulgacao_fixar_faixa",{p_ator:a.userId,p_titular:valor(form,"titular"),p_faixa:valor(form,"faixa")||null,p_motivo:valor(form,"motivo")});
  resposta(central,error,"Decisão de faixa registrada.");
}
export async function ajustarRegrasImovel(form: FormData) {
  const a=await operador(), metas=[];
  for(let etapa=1;etapa<=12;etapa++){
    const quantidade=valor(form,"quantidade_"+etapa),dias=valor(form,"dias_"+etapa);
    if(!quantidade&&!dias)continue;
    if(!quantidade||!dias)mensagem(central,"Preencha a quantidade e o prazo de cada meta escolhida.");
    metas.push({etapa,quantidade:Number(quantidade),dias:Number(dias)});
  }
  const {error}=await supabaseAdmin().rpc("divulgacao_criterios_imovel",{p_ator:a.userId,p_imovel:valor(form,"imovel"),p_faixa:valor(form,"faixa")||null,
    p_regiao:valor(form,"regiao")||null,p_campanha:valor(form,"campanha")||null,p_metas:metas});
  resposta(central,error,"Critérios do imóvel salvos. Novas reservas receberão as metas.");
}
