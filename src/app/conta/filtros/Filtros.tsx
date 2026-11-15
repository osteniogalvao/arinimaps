"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CAMPO } from "@/components/ui/Pagina";

type Filtro = { id: string; nome: string; ativo: boolean; whatsapp: boolean; municipioNome: string | null; tipo: string | null;
  preco_min: number | null; preco_max: number | null; area_min: number | null; area_max: number | null; essenciais: string; financiamento: boolean; permuta: boolean };
type Aviso = { id: string; codigo: string; titulo: string; data: string; lido: boolean };
export default function Filtros({ filtros, avisos, limite, municipios, iniciais, consentiu }: {
  filtros: Filtro[]; avisos: Aviso[]; limite: number; municipios: {id:string;nome:string;uf:string}[];
  iniciais: Record<string,string>; consentiu: boolean;
}) {
  const router = useRouter();
  const [mensagem,setMensagem] = useState("");
  const [ocupado,setOcupado] = useState(false);
  const [tipo,setTipo] = useState(iniciais.tipo ?? "");
  const ativos = filtros.filter(f=>f.ativo);
  async function enviar(dados: Record<string,unknown>) {
    setOcupado(true); setMensagem("");
    try {
      const r = await fetch("/api/conta/filtros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
      const resposta = await r.json();
      if (!r.ok) throw new Error(resposta.error || "Falha ao salvar.");
      setMensagem(dados.aviso ? "Aviso marcado como lido." : "Filtro salvo."); router.refresh();
    } catch (e) { setMensagem(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setOcupado(false); }
  }
  async function criar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k:string) => f.get(k) ? Number(f.get(k)) : null;
    const area = (k:string) => { const v=num(k); return v === null ? null : v*(tipo==="urbano"?1:10000); };
    await enviar({ nome: f.get("nome"), tipo: tipo||null, municipio: f.get("municipio")||null, essenciais: f.get("essenciais"),
      preco_min: num("preco_min"), preco_max: num("preco_max"), area_min: area("area_min"), area_max: area("area_max"),
      financiamento: f.has("financiamento"), permuta: f.has("permuta"), whatsapp: f.has("whatsapp") });
  }
  const campoNum = (nome:string,rotulo:string) => <label>{rotulo}<input type="number" min="0" max="100000000000000" step="any" name={nome}
    className={CAMPO} defaultValue={iniciais[nome] ?? ""} /></label>;
  return <div className="space-y-7">
    <section><h2 className="mb-2 text-xl font-semibold">Novos imóveis para você</h2>
      {avisos.length ? <ul className="divide-y divide-linha">{avisos.map(v=><li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div><Link href={"/imovel/"+encodeURIComponent(v.codigo)} className="font-semibold underline">{v.titulo || v.codigo}</Link> · {v.data}</div>
        {!v.lido && <button className="text-sm underline" type="button" disabled={ocupado} onClick={()=>enviar({aviso:v.id})}>Marcar como lido</button>}
      </li>)}</ul> : <p>Os próximos imóveis publicados que atendam aos seus critérios aparecerão aqui.</p>}
    </section>
    <section><h2 className="mb-1 text-xl font-semibold">Minhas buscas</h2><p>{Math.min(ativos.length,limite)} de {limite} filtros ativos.</p>
      <ul className="divide-y divide-linha">{filtros.map((f)=><li key={f.id} className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{f.nome}</strong>
          <button type="button" className="underline" disabled={ocupado} onClick={()=>enviar({ id:f.id, ativo:!f.ativo })}>{f.ativo ? "Desativar" : "Reativar"}</button></div>
        <p className="text-sm text-texto-2">{[f.tipo ?? "Todos os tipos", f.municipioNome || "Todos os municípios", f.essenciais,
          f.preco_min!=null && "a partir de R$ "+Number(f.preco_min).toLocaleString("pt-BR"), f.preco_max!=null && "até R$ "+Number(f.preco_max).toLocaleString("pt-BR"),
          f.area_min!=null && "mín. "+Number(f.area_min).toLocaleString("pt-BR")+" m²", f.area_max!=null && "máx. "+Number(f.area_max).toLocaleString("pt-BR")+" m²",
          f.permuta && "Aceita permuta", f.financiamento && "Aceita financiamento",
          !f.ativo ? "Desativado" : ativos.indexOf(f)>=limite ? "Pausado pelo limite atual" : "Ativo", f.whatsapp && consentiu && "Aviso no WhatsApp"].filter(Boolean).join(" · ")}</p>
      </li>)}</ul>
    </section>
    <form className="cartao space-y-4 p-5" onSubmit={criar}>
      <h2 className="text-xl font-semibold">Criar filtro de interesse</h2>
      <label className="block">Nome da busca<input required maxLength={80} name="nome" className={CAMPO} placeholder="Ex. Fazenda com nascente" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Tipo<select value={tipo} onChange={e=>setTipo(e.target.value)} className={CAMPO}>
          <option value="">Todos</option><option value="rural">Rural</option><option value="urbano">Urbano</option><option value="leilao">Leilão</option></select></label>
        <label>Município<select name="municipio" defaultValue={iniciais.municipio} className={CAMPO}><option value="">Todos</option>
          {municipios.map(m=><option key={m.id} value={m.id}>{m.nome} / {m.uf}</option>)}</select></label>
        {campoNum("preco_min","Preço mínimo (R$)")}{campoNum("preco_max","Preço máximo (R$)")}
        {campoNum("area_min","Área mínima ("+(tipo==="urbano"?"m²":"ha")+")")}{campoNum("area_max","Área máxima ("+(tipo==="urbano"?"m²":"ha")+")")}
      </div>
      <label className="block">Palavras no título ou descrição<input name="essenciais" maxLength={120} defaultValue={iniciais.q} className={CAMPO} placeholder="Ex. nascente" /></label>
      <div className="grid gap-2"><label><input type="checkbox" name="financiamento" /> Aceita financiamento</label>
        <label><input type="checkbox" name="permuta" /> Aceita permuta</label>
        <label><input type="checkbox" name="whatsapp" disabled={!consentiu} /> Receber também pelo WhatsApp</label>
        {!consentiu && <Link className="text-sm underline" href="/privacidade/preferencias">Autorizar avisos no WhatsApp nas preferências</Link>}
      </div><button disabled={ocupado || ativos.length>=limite} className="btn-verde px-4 py-2 disabled:opacity-50">Salvar filtro</button>
    </form><p role="status" aria-live="polite">{mensagem}</p>
  </div>;
}