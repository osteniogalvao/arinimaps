import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { saldoAri } from "@/lib/ia/creditos";
import { pacoteDaAri, linkFaturaAri } from "@/lib/ia/pacote";
import { lerConfiguracoes } from "@/lib/settings";
import ComprarPacote from "./ComprarPacote";

export const dynamic = "force-dynamic";
const formatarData = (v: string) => new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const nomes: Record<string,string> = { chat: "Conversa", imagem: "Busca por imagem", matricula: "Leitura de matrícula", cadastro: "Cadastro de imóvel" };

export default async function CarteiraDaAri() {
  const a = await ator();
  if (!a) redirect("/entrar?volta=%2Fconta%2Fcreditos");
  if (a.ehArini) redirect("/conta");
  const db = supabaseAdmin();
  const nicho = a.nicho ?? "";
  const [saldo, pacote, compras, uso, lotes, cfg] = await Promise.all([
    saldoAri(a.userId, nicho), pacoteDaAri(a),
    db.from("ari_compras").select("id,status,preco,criado_em,link").eq("titular", a.userId).eq("nicho", nicho).order("criado_em", { ascending: false }).limit(20),
    db.from("ari_uso").select("id,operacao,custo,criado_em,estornado_em").eq("titular", a.userId).eq("nicho", nicho).order("criado_em", { ascending: false }).limit(30),
    db.from("ari_lotes").select("id,carteira,saldo,validade").eq("titular", a.userId).eq("nicho", nicho).in("carteira", ["compra","cortesia"])
      .gt("saldo", 0).eq("bloqueado", false).gt("validade", new Date().toISOString()).order("validade").limit(30),
    lerConfiguracoes(),
  ]);
  if (compras.error || uso.error || lotes.error) throw new Error("Não foi possível consultar o extrato.");
  return <main className="mx-auto max-w-3xl space-y-6 px-5 py-10">
    <Link href="/conta" className="text-sm underline">Minha conta</Link>
    <h1 className="lp-display text-4xl">Carteira da Ari</h1>
    <div className="cartao space-y-2 p-5"><h2 className="text-xl font-semibold">{saldo.total} créditos disponíveis</h2>
      <p>Franquia do plano neste mês: {saldo.plano}. Comprados: {saldo.comprados}. Cortesia: {saldo.cortesia}.</p>
      <p className="text-sm text-texto-2">Limite diário de {Number(cfg.ari_limite_creditos_dia)} créditos. Cada conversa usa {Number(cfg.ari_custo_chat)}, busca por imagem {Number(cfg.ari_custo_imagem)}, leitura de matrícula {Number(cfg.ari_custo_matricula)} e cadastro de imóvel {Number(cfg.ari_custo_cadastro)}.</p>
      {lotes.data?.map((l) => <p key={l.id} className="text-sm">{l.saldo} de {l.carteira === "compra" ? "compra" : "cortesia"} disponíveis até {formatarData(l.validade)}.</p>)}
    </div>
    {pacote ? <ComprarPacote pacote={pacote} /> : a.nicho !== "comprador_investidor" && <Link href="/conta/perfis" className="block underline">Acessar o perfil comprador para consultar o pacote avulso</Link>}
    <section><h2 className="mb-2 text-xl font-semibold">Compras recentes</h2>
      {compras.data?.length ? <ul className="divide-y divide-linha">{compras.data.map((p) => <li className="py-2" key={p.id}>
        {formatarData(p.criado_em)} · {(p.preco / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · {p.status}
        {p.status === "aberta" && linkFaturaAri(p.link) && <a className="ml-3 underline" href={linkFaturaAri(p.link)!} target="_blank" rel="noopener noreferrer">Abrir fatura</a>}
      </li>)}</ul> : <p>Nenhuma compra neste perfil.</p>}
    </section>
    <section><h2 className="mb-2 text-xl font-semibold">Histórico de consumo</h2>
      {uso.data?.length ? <ul className="divide-y divide-linha">{uso.data.map((u) => <li key={u.id} className="py-2">{formatarData(u.criado_em)} · {nomes[u.operacao]} · {u.custo} crédito(s){u.estornado_em ? " devolvido(s)" : ""}</li>)}</ul> : <p>Nenhum consumo neste perfil.</p>}
    </section>
  </main>;
}