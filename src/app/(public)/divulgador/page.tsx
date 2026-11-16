import Link from "next/link";
import { ator } from "@/lib/authz";
import { botaoDiv, caixaDiv, campoDiv, nomesEstado, situacaoPiloto } from "@/lib/divulgacao";
import { abrirPainel, inscrever } from "./acoes";
import Carteira from "./Carteira";
type Busca=Promise<{aviso?:string;tipo?:string;regiao?:string}>;
export default async function Divulgador({searchParams}:{searchParams:Busca}) {
  const a=await ator(), p=await situacaoPiloto(a?.userId), {aviso,tipo,regiao}=await searchParams;
  return <main className="mx-auto w-full max-w-3xl space-y-6 px-5 py-12">
    <Link className="text-verde underline" href={a?"/conta/perfis":"/planos?perfil=divulgador"}>{a?"Perfis de acesso":"Perfis da ARINI"}</Link>
    <h1 className="lp-display text-4xl">Programa de divulgadores</h1>
    {aviso && <p role="status" className={caixaDiv}>{aviso}</p>}
    {!p.disponivel ? <p role="alert">O cadastro está temporariamente indisponível. Tente novamente.</p>
    : !a ? <section className={caixaDiv}><h2 className="text-xl font-semibold">{p.temVaga?"Inscrições abertas":"Em breve"}</h2>
      <p>{p.temVaga?"A Matriz analisa o seu Instagram, a sua região e o cadastro da empresa ou MEI.":"Entre para registrar seu interesse em participar do piloto."}</p>
      <Link className={botaoDiv} href="/entrar?volta=%2Fdivulgador">{p.temVaga?"Entrar para participar":"Avise-me"}</Link>{" "}
      <Link className="text-verde underline" href="/entrar?cadastro=1&volta=%2Fdivulgador">Criar conta</Link></section>
    : a.ehArini || a.role==="franqueado" ? <p>Use uma conta individual de participante para se inscrever.</p>
    : <><section className={caixaDiv}>
      <h2 className="text-xl font-semibold">{p.estado?nomesEstado[p.estado]:p.temVaga?"Solicitar participação":"Em breve"}</h2>
      {p.motivo && <p>{p.motivo}</p>}
      {p.estado==="ativo" && (p.aberto ? a.nicho==="divulgador" ? <div className="flex gap-5"><Link className="text-verde underline" href="/mapa">Consultar o mapa</Link><Link className="text-verde underline" href="/imoveis">Ver imóveis à venda</Link></div> : <form action={abrirPainel}><button className={botaoDiv}>Usar perfil de divulgador</button></form> : <p>O piloto está pausado.</p>)}
      {(!p.estado || p.estado==="espera"&&p.temVaga) && <form action={inscrever} className="space-y-3">
        {p.temVaga ? <><label className="block">Instagram público<input className={campoDiv} name="instagram" placeholder="@seuperfil" maxLength={31} required/></label>
        <label className="block">CNPJ da empresa ou MEI<input className={campoDiv} name="cnpj" inputMode="numeric" maxLength={18} required/></label>
        <label className="block">Região de atuação<input className={campoDiv} name="regiao" minLength={2} maxLength={100} required/></label></>
        : <p>O piloto está fechado ou atingiu o limite. Registre seu interesse para a Matriz acompanhar a fila.</p>}
        <button className={botaoDiv}>{p.temVaga?"Enviar para análise":"Avise-me"}</button>
      </form>}
    </section>{p.estado==="ativo"&&p.aberto&&a.nicho==="divulgador"&&<Carteira titular={a.userId} tipo={tipo} regiao={regiao}/>}</>}
  </main>;
}
