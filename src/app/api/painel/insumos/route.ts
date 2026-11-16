import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limitar,respostaLimite } from "@/lib/seguranca/limite";
import { createHash } from "node:crypto";
import { CorpoMuitoGrande, limitarFluxo } from "@/lib/seguranca/corpo-limitado";

export async function POST(req:Request) {
  const a=await ator();
  if (!a?.acesso.recursos.has("comparador_insumos")) return NextResponse.json({error:"O plano ativo não permite comparar notas de compra."},{status:403});
  const acesso=await limitar("insumos:"+a.userId,30,600);
  if(!acesso.permitido) return respostaLimite(acesso,"importações de insumos");
  if (Number(req.headers.get("content-length"))>512000) return NextResponse.json({error:"Nota muito grande."},{status:413});
  let b;
  try { b=await new Response(req.body && limitarFluxo(req.body,512000)).json(); }
  catch(e) { return e instanceof CorpoMuitoGrande ? NextResponse.json({error:"Nota muito grande."},{status:413}) : NextResponse.json({error:"Formato inválido."},{status:400}); }
  const invalido=()=>NextResponse.json({error:"Confira a nota, o fornecedor e os valores dos itens."},{status:400});
  if(!b || !Array.isArray(b.itens) || !b.itens.length || b.itens.length>990 || typeof b.chave!=="string" || !/^[a-f0-9]{64}$/.test(b.chave) ||
     typeof b.emissao!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.emissao) || !Number.isFinite(Date.parse(b.emissao)) ||
     new Date(b.emissao).toISOString().slice(0,10)!==b.emissao || typeof b.fornecedor!=="string" || !b.fornecedor.trim() || b.fornecedor.length>160) return invalido();
  const documento=createHash("sha256").update(a.userId+":"+b.chave).digest("hex");
  const linhas=[];const vistos=new Set<number>();
  for(const i of b.itens){
    if(!i || !Number.isInteger(i.item) || i.item<1 || i.item>990 || vistos.has(i.item) || typeof i.produto!=="string" || !i.produto.trim() || i.produto.length>160 ||
      typeof i.unidade!=="string" || !i.unidade.trim() || i.unidade.length>8 || !Number.isFinite(i.quantidade) || i.quantidade<0.0001 || i.quantidade>=1e14 ||
      !Number.isFinite(i.total) || i.total<0 || i.total>=1e16 || (i.gtin!==null && (typeof i.gtin!=="string" || !/^(?:[0-9]{8}|[0-9]{12,14})$/.test(i.gtin)))) return invalido();
    vistos.add(i.item); linhas.push({titular:a.userId,documento,emissao:b.emissao,fornecedor:b.fornecedor.trim(),item:i.item,produto:i.produto.trim(),unidade:i.unidade.trim().toUpperCase(),
      quantidade:i.quantidade,total:i.total,gtin:i.gtin});
  }
  const {error,data}=await supabaseAdmin().from("insumos_compras").upsert(linhas,{onConflict:"titular,documento,item",ignoreDuplicates:true}).select("item");
  return error?NextResponse.json({error:"Não foi possível registrar os itens agora."},{status:503}):NextResponse.json({inseridos:data?.length??0});
}
export async function DELETE(req:Request) {
  const a=await ator(); if(!a) return NextResponse.json({error:"Entre novamente."},{status:401});
  const doc=new URL(req.url).searchParams.get("nota")??"";if(!/^[a-f0-9]{64}$/.test(doc))return NextResponse.json({error:"Nota inválida."},{status:400});
  const {error}=await supabaseAdmin().from("insumos_compras").delete().eq("titular",a.userId).eq("documento",doc);
  return error?NextResponse.json({error:"Não foi possível excluir."},{status:503}):NextResponse.json({ok:true});
}
