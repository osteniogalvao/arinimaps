"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import type { DocumentoCofre, PropriedadeCofre } from "@/lib/cofre";

const api = "/api/painel/cofre";
const acao = "btn-contorno px-4 py-2 text-sm";
type Lista = { propriedades: PropriedadeCofre[]; total:number; limite:number };
async function enviar(url:string, init?:RequestInit) {
  const r = await fetch(url,{cache:"no-store",...init});
  const dados = await r.json();
  if (!r.ok) throw Error(dados.error ?? "Falha ao acessar o cofre.");
  return dados;
}
const mensagem = (e:unknown) => e instanceof Error ? e.message : "Falha de conexão.";

function Documentos({imovel}:{imovel:string}) {
  const base = api + "/documentos?propriedade=" + imovel;
  const [pagina,setPagina] = useState(1);
  const [versao,setVersao] = useState(0);
  const [lista,setLista] = useState<{documentos:DocumentoCofre[];temMais:boolean} | null>(null);
  const [erro,setErro] = useState("");
  const [ocupado,setOcupado] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    enviar(base + "&pagina=" + pagina,{signal:ac.signal})
      .then(d => { if (!ac.signal.aborted) setLista(d); })
      .catch(e => { if (!ac.signal.aborted) setErro(mensagem(e)); });
    return () => ac.abort();
  },[base,pagina,versao]);
  async function executar(operacao:() => Promise<unknown>) {
    setOcupado(true); setErro("");
    try { await operacao(); setPagina(1); setLista(null); setVersao(v => v+1); }
    catch(e) {setErro(mensagem(e));} finally {setOcupado(false);}
  }
  async function anexar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form=e.currentTarget, f=new FormData(form).get("arquivo");
    if (!(f instanceof File) || !f.size || f.size > 25*1024*1024) {setErro("Selecione um documento de até 25 MB."); return;}
    await executar(async () => {await enviar(base,{method:"POST",headers:{"X-Nome-Arquivo":encodeURIComponent(f.name)},body:f}); form.reset();});
  }
  return <section className="space-y-3 border-t border-linha pt-4">
    <h3 className="font-semibold">Documentos privados</h3>
    <form onSubmit={anexar} className="flex flex-wrap items-end gap-3">
      <label className={ROTULO}>Arquivo de até 25 MB
        <input type="file" name="arquivo" required className="block mt-2 text-sm" /></label>
      <button disabled={ocupado} className={acao}>{ocupado ? "Aguarde…" : "Anexar documento"}</button>
    </form>
    {erro && <p role="alert" className="text-critico">{erro}</p>}
    {!lista && !erro && <p role="status">Carregando documentos…</p>}
    {lista?.documentos.length === 0 && <p>Ainda não há documentos nesta página.</p>}
    {lista?.documentos.map(d => <div key={d.id} className="flex flex-wrap gap-3 items-center">
      <a href={d.url} className="underline break-all">Baixar {d.nome_arquivo}</a>
      <span className="text-sm">{Math.ceil(d.tamanho_bytes/1024)} KB</span>
      <button type="button" disabled={ocupado} className={acao} onClick={() => {
        if (window.confirm("Excluir este documento do cofre?")) void executar(() => enviar(base + "&id=" + d.id,{method:"DELETE"}));
      }}>Excluir documento</button></div>)}
    {(pagina>1 || lista?.temMais) && <div className="flex gap-3">
      <button className={acao} disabled={pagina===1} onClick={() => {setLista(null);setPagina(v=>v-1);}}>Anterior</button>
      <button className={acao} disabled={!lista?.temMais} onClick={() => {setLista(null);setPagina(v=>v+1);}}>Próxima</button></div>}
  </section>;
}

export default function Cofre({produtor}:{produtor:boolean}) {
  const [lista,setLista] = useState<Lista | null>(null);
  const [pagina,setPagina] = useState(1);
  const [versao,setVersao] = useState(0);
  const [editando,setEditando] = useState<PropriedadeCofre | null>(null);
  const [nova,setNova] = useState(false);
  const [aberta,setAberta] = useState<string | null>(null);
  const [erro,setErro] = useState("");
  const [ocupado,setOcupado] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    enviar(api + "?pagina=" + pagina,{signal:ac.signal}).then(d=>{if (!ac.signal.aborted) setLista(d);})
      .catch(e=>{if (!ac.signal.aborted) setErro(mensagem(e));});
    return () => ac.abort();
  },[pagina,versao]);
  function atualizar() {setErro("");setLista(null);setVersao(v=>v+1);}
  async function salvar(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editando) return;
    const campos = Object.fromEntries(new FormData(e.currentTarget));
    setOcupado(true);setErro("");
    try {
      await enviar(api,{method:nova?"POST":"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...campos,area_ha:Number(campos.area_ha),id:editando.id})});
      setEditando(null);setAberta(editando.id);setPagina(1);atualizar();
    } catch(e) {setErro(mensagem(e));} finally {setOcupado(false);}
  }
  async function excluir(id:string) {
    if (!window.confirm("Excluir a propriedade e todos os documentos dela do seu cofre?")) return;
    setOcupado(true);setErro("");
    try {await enviar(api + "?id=" + id,{method:"DELETE"});setEditando(null);setPagina(1);atualizar();}
    catch(e) {setErro(mensagem(e));} finally {setOcupado(false);}
  }
  const plano = produtor ? "perfil=produtor&pacote=produtor_essencial" : "perfil=vender&pacote=proprietario_gratuito";
  return <div className="space-y-5">
    {erro && <p role="alert" className="text-critico">{erro} <button className="underline" onClick={atualizar}>Atualizar lista</button></p>}
    {!lista && !erro && <p role="status">Carregando cofre…</p>}
    {lista && <div className="flex items-center flex-wrap gap-4"><p>{lista.total} de {lista.limite} vagas utilizadas</p>
      <button type="button" disabled={lista.total>=lista.limite || ocupado} className={acao} onClick={()=>{
        setNova(true);setErro("");setEditando({id:crypto.randomUUID(),nome:"",municipio:"",area_ha:0,car:null,matricula:null});
      }}>Adicionar propriedade</button>
      <Link className="underline" href={"/planos?" + plano + "&extra_propriedade_adicional=1#configuracao"}>Solicitar mais vagas · R$ 15 por propriedade/mês</Link></div>}
    {editando && <form onSubmit={salvar} key={editando.id} className="cartao p-5 space-y-4">
      <h2 className="font-semibold">{nova ? "Adicionar propriedade" : "Editar propriedade"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {([["nome","Nome da propriedade",true],["municipio","Município / UF",true],["car","CAR declarado",false],["matricula","Matrícula declarada",false]] as const)
        .map(([id,rotulo,obrigatorio])=><label key={id} className={ROTULO}>{rotulo}<input name={id} defaultValue={editando[id] ?? ""} required={obrigatorio} maxLength={160} className={CAMPO}/></label>)}
        <label className={ROTULO}>Área declarada (ha)<input name="area_ha" type="number" step="any" min="0" required
          defaultValue={editando.area_ha || ""} className={CAMPO}/></label></div>
      <div className="flex gap-3"><button className={acao} disabled={ocupado}>Salvar propriedade</button>
        <button className={acao} type="button" disabled={ocupado} onClick={()=>setEditando(null)}>Cancelar</button></div></form>}
    {lista?.total === 0 && !editando && <p>Você ainda não cadastrou propriedades no cofre.</p>}
    {lista?.propriedades.map(p=><article className="cartao p-5 space-y-3" key={p.id}>
      <h2 className="font-semibold text-lg">{p.nome}</h2><p>{p.municipio} · {Number(p.area_ha).toLocaleString("pt-BR",{maximumFractionDigits:6})} ha</p>
      {p.car && <p>CAR declarado: {p.car}</p>}{p.matricula && <p>Matrícula declarada: {p.matricula}</p>}
      <div className="flex flex-wrap gap-2"><button className={acao} onClick={()=>setAberta(aberta===p.id?null:p.id)} aria-expanded={aberta===p.id}>Documentos</button>
        <button className={acao} disabled={ocupado} onClick={()=>{setEditando(p);setNova(false);setErro("");}}>Editar</button>
        <button className={acao} disabled={ocupado} onClick={()=>excluir(p.id)}>Excluir propriedade</button></div>
      {aberta===p.id && <Documentos imovel={p.id}/>}</article>)}
    {(pagina>1 || (lista && pagina*25<lista.total)) && <div className="flex gap-3">
      <button className={acao} disabled={pagina===1 || ocupado} onClick={()=>{setLista(null);setPagina(v=>v-1);}}>Anterior</button>
      <button className={acao} disabled={!lista || pagina*25>=lista.total || ocupado} onClick={()=>{setLista(null);setPagina(v=>v+1);}}>Próxima</button></div>}
  </div>;
}
