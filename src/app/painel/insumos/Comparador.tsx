'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {lerNota,type Compra} from '@/lib/insumos-nota';
const moeda=(n:number)=>n.toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:4});
export default function Comparador({compras,grupos,selecionado,busca,pagina,paginaGrupos,maisGrupos,maisItens}:{compras:Compra[];grupos:{grupo:string;nome:string;menor:number}[];
 selecionado:string;busca:string;pagina:number;paginaGrupos:number;maisGrupos:boolean;maisItens:boolean}) {
  const router=useRouter();const [nota,setNota]=useState<Awaited<ReturnType<typeof lerNota>>|null>(null);
  const [aviso,setAviso]=useState(""),[ocupado,setOcupado]=useState(false);
  const [excluir,setExcluir]=useState("");const ativo=grupos.find(g=>g.grupo===selecionado);
  function href(grupo:string,pg:number,lista:number){return "/painel/insumos?"+new URLSearchParams({busca,grupo,pg:String(pg),lista:String(lista)})+"#compras";}
  const lista=compras;
  async function enviar(acao:"salvar"|"excluir"){
    setOcupado(true);
    try {
      const r=await fetch(acao==="salvar"?"/api/painel/insumos":"/api/painel/insumos?nota="+encodeURIComponent(excluir),acao==="salvar"
        ?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(nota)}:{method:"DELETE"});
      const d=await r.json();if(!r.ok)throw Error(d.error||"Não foi possível concluir.");
      if(acao==="salvar"){setAviso(d.inseridos?d.inseridos+" item(ns) registrado(s).":"Esta nota já foi registrada.");setNota(null);}
      else{setExcluir("");setAviso("Itens da nota excluídos.");}router.refresh();
    }catch(e){setAviso(e instanceof Error?e.message:"Falha de conexão.");}finally{setOcupado(false);}
  }
  return <section id="compras" className="cartao mt-6 max-w-4xl space-y-4 p-6"><h2 className="text-xl font-semibold">Preços das minhas compras</h2>
    <p>Selecione o XML processado da NF-e. Você pode conferir os itens antes de registrar. O XML completo fica no seu aparelho; somente os dados comerciais dos itens são salvos na sua conta.</p>
    <label className="block text-sm">Escolher nota fiscal de compra <input type="file" accept=".xml,application/xml,text/xml" disabled={ocupado} onChange={async e=>{
      const f=e.target.files?.[0];e.target.value="";setNota(null);setAviso("");if(!f)return;setOcupado(true);
      try{setNota(await lerNota(f));}catch(err){setAviso(err instanceof Error?err.message:"XML inválido.");}finally{setOcupado(false);}
    }}/></label>
    {nota && <div className="rounded border border-linha p-4"><p><strong>{nota.fornecedor}</strong> · {nota.emissao} · {nota.itens.length} itens</p>
      <ul className="my-2 max-h-48 overflow-auto">{nota.itens.map(i=><li key={i.item}>{i.produto} · {i.quantidade} {i.unidade} · {moeda(i.total)}</li>)}</ul>
      <button disabled={ocupado} className="btn-verde px-4 py-2" onClick={()=>enviar("salvar")}>Registrar itens na minha conta</button></div>}
    <p aria-live="polite">{aviso}</p>
    <form action="/painel/insumos#compras"><label>Procurar produto em todas as notas <input maxLength={100} name="busca" defaultValue={busca}/></label> <button className="underline">Pesquisar</button></form>
    {(!grupos.length && busca) && <p>Nenhum produto encontrado.</p>}
    <nav aria-label="Páginas de produtos" className="flex gap-3">{paginaGrupos>0 && <Link className="underline" href={href("",0,paginaGrupos-1)}>Produtos anteriores</Link>}
     {maisGrupos && <Link className="underline" href={href("",0,paginaGrupos+1)}>Próximos produtos</Link>}</nav>
    {grupos.length>0 && <><label>Comparar produto <select aria-label="Comparar produto" className="block max-w-full" value={selecionado} onChange={e=>router.push(href(e.target.value,0,paginaGrupos))}>
      {grupos.map(g=><option key={g.grupo} value={g.grupo}>{g.nome}</option>)}</select></label>
      <p className="text-sm text-texto-2">Preço por unidade = (valor bruto do item − desconto do item) ÷ quantidade. Sem rateio de frete ou tributos. Só comparamos a mesma unidade e o mesmo código de barras; sem código, agrupamos pela descrição.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Emissão","Fornecedor","Quantidade","Preço por unidade","Nota"].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead>
      <tbody>{lista.map(c=><tr key={c.documento+c.item}><td>{c.emissao.split("-").reverse().join("/")}</td><td>{c.fornecedor}</td><td>{c.quantidade} {c.unidade}</td><td>{moeda(c.total/c.quantidade)}</td><td><button className="underline" onClick={()=>setExcluir(c.documento)}>Excluir nota</button></td></tr>)}</tbody></table></div>
      {ativo && <p>Menor preço registrado neste grupo: <strong>{moeda(Number(ativo.menor))} por unidade comercial</strong>.</p>}
      <nav aria-label="Histórico do produto" className="flex gap-3">{pagina>0 && <Link className="underline" href={href(selecionado,pagina-1,paginaGrupos)}>Itens anteriores</Link>}
       {maisItens && <Link className="underline" href={href(selecionado,pagina+1,paginaGrupos)}>Próximos itens</Link>}</nav>
      {excluir && <div role="group" aria-label="Excluir nota"><p>Excluir todos os itens dessa nota da sua conta?</p><button disabled={ocupado} className="mr-4 underline" onClick={()=>enviar("excluir")}>Excluir todos os itens</button><button onClick={()=>setExcluir("")}>Manter nota</button></div>}
      </>}
  </section>;
}
