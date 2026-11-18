import Moldura from "@/components/shell/Moldura";
import { currentUser } from "@/lib/supabase/server";
import Link from "next/link";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ServicoMunicipal, PedidoMunicipal } from "@/lib/territorio-contratado";
import Balcao from "@/components/territorio/Balcao";

export const dynamic="force-dynamic";
export default async function BalcaoExterno() {
  const a=await ator();const db=supabaseAdmin();
  const [servicos,pedidos]=await Promise.all([db.rpc("fn_balcao_servicos",{p_gestor:null}),
    a?db.rpc("fn_balcao_pedidos",{p_titular:a.userId,p_interno:false}):{data:[],error:null}]);
  if (servicos.error || pedidos.error) throw new Error("Não foi possível abrir o balcão.");
  // auditoria mobile 18/11: a página abria sem o cabeçalho do site (sem menu, sem
  // volta) — no celular a pessoa ficava presa nela
  const u = await currentUser();
  const usuario = u ? { nome: u.nome || "Conta", papel: "Usuário" } : null;
  return <Moldura usuario={usuario} site><main className="mx-auto max-w-3xl space-y-6 px-5 py-10"><Link href="/planos?perfil=instituicao" className="text-sm underline">Acesso institucional</Link>
    <h1 className="lp-display text-4xl">Balcão digital municipal</h1>
    {a?<Balcao servicos={servicos.data as ServicoMunicipal[]} pedidos={pedidos.data as PedidoMunicipal[]}/>:
      <section className="space-y-3">{(servicos.data as ServicoMunicipal[]).map(s=><p key={s.id}>{s.municipio} · {s.nome}</p>)}
        {!servicos.data?.length && <p>Nenhum serviço municipal está recebendo pedidos no momento.</p>}
        <Link href="/entrar?volta=%2Fbalcao" className="btn-verde inline-block px-4 py-2">Entrar para protocolar ou acompanhar</Link>
      </section>}</main></Moldura>;
}