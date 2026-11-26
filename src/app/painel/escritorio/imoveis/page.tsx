import Link from "next/link";
import {
  FINALIDADES, STATUS_IMOVEL, TIPOS_IMOVEL, UNIDADES_AREA, UUID_ESC, reais,
} from "@/lib/crm-escritorio";
import {
  Avisos, BOTAO, BOTAO_VERDE, BotaoExcluir, CAMPO_P, CabecalhoEscritorio, CampoResponsavel, SemEscritorio, abrirEscritorio, umParam,
  type Parametros,
} from "../comum";
import { salvarImovel } from "../acoes";

type Imovel = {
  id: string; codigo: string; tipo: keyof typeof TIPOS_IMOVEL; finalidade: keyof typeof FINALIDADES; titulo: string;
  cidade: string | null; bairro: string | null; endereco: string | null; link_mapa: string | null; valor: number | null;
  area: number | null; area_unidade: keyof typeof UNIDADES_AREA; quartos: number | null; vagas: number | null;
  proprietario_id: string | null; status: keyof typeof STATUS_IMOVEL; observacoes: string | null; responsavel: string | null;
  proprietario: { nome: string; telefone: string | null } | null;
};

/** Carteira de imóveis do escritório, com código automático por tipo (CA-0001, AP-0001…). */
export default async function ImoveisEscritorio({ searchParams }: { searchParams: Promise<Parametros> }) {
  const s = await abrirEscritorio();
  if (s.status !== 200) return <SemEscritorio status={s.status} />;
  const sp = await searchParams;
  const status = umParam(sp, "status"), tipo = umParam(sp, "tipo"), busca = umParam(sp, "q").slice(0, 60);
  const editar = UUID_ESC.test(umParam(sp, "editar")) ? umParam(sp, "editar") : null;
  const volta = "/painel/escritorio/imoveis?" + new URLSearchParams({ ...(status ? { status } : {}), ...(tipo ? { tipo } : {}), ...(busca ? { q: busca } : {}) });

  let q = s.banco.from("crm_esc_imoveis")
    .select("id,codigo,tipo,finalidade,titulo,cidade,bairro,endereco,link_mapa,valor,area,area_unidade,quartos,vagas,proprietario_id,status,observacoes,responsavel,proprietario:crm_esc_pessoas(nome,telefone)")
    .order("atualizado_em", { ascending: false }).limit(500);
  if (Object.hasOwn(STATUS_IMOVEL, status)) q = q.eq("status", status);
  if (Object.hasOwn(TIPOS_IMOVEL, tipo)) q = q.eq("tipo", tipo);
  if (busca) { const b = busca.replace(/[%_,()]/g, " "); q = q.or(`titulo.ilike.%${b}%,codigo.ilike.%${b}%,cidade.ilike.%${b}%,bairro.ilike.%${b}%`); }
  const [imoveis, proprietarios] = await Promise.all([
    q,
    s.banco.from("crm_esc_pessoas").select("id,nome").in("tipo", ["proprietario", "cliente", "parceiro"]).order("nome").limit(1000),
  ]);
  const lista = (imoveis.data ?? []) as unknown as Imovel[];
  let emEdicao = editar ? lista.find((i) => i.id === editar) : undefined;
  if (editar && !emEdicao) {
    const r = await s.banco.from("crm_esc_imoveis").select("*").eq("id", editar).maybeSingle();
    emEdicao = (r.data ?? undefined) as Imovel | undefined;
  }
  const nome = new Map(s.membros.map((m) => [m.user_id, m.nome]));

  return <section>
    <CabecalhoEscritorio espaco={s.espaco} ativa="imoveis" titulo="Carteira de imóveis"
      subtitulo="Cada imóvel recebe um código pelo tipo, em sequência. Vincule o proprietário e use o código no funil e na agenda." />
    <Avisos sp={sp} />

    <details className="cartao mb-6 p-4" open={!!emEdicao || (!lista.length && !busca && !status && !tipo)}>
      <summary className="cursor-pointer font-semibold">{emEdicao ? `Editar ${emEdicao.codigo}` : "Cadastrar imóvel"}</summary>
      <form action={salvarImovel} className="mt-4 grid gap-3 md:grid-cols-4" key={emEdicao?.id ?? "novo"}>
        <input type="hidden" name="_volta" value={volta} />
        {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}
        <label className="grid gap-1 text-sm md:col-span-2">Título<input name="titulo" required defaultValue={emEdicao?.titulo} className={CAMPO_P} placeholder="Ex.: Casa 3 quartos no Centro" /></label>
        <label className="grid gap-1 text-sm">Tipo<select name="tipo" defaultValue={emEdicao?.tipo ?? "casa"} className={CAMPO_P} disabled={!!emEdicao}>
          {Object.entries(TIPOS_IMOVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {emEdicao && <input type="hidden" name="tipo" value={emEdicao.tipo} />}</label>
        <label className="grid gap-1 text-sm">Finalidade<select name="finalidade" defaultValue={emEdicao?.finalidade ?? "venda"} className={CAMPO_P}>
          {Object.entries(FINALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Cidade<input name="cidade" defaultValue={emEdicao?.cidade ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Bairro<input name="bairro" defaultValue={emEdicao?.bairro ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm md:col-span-2">Endereço<input name="endereco" defaultValue={emEdicao?.endereco ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm md:col-span-2">Link do Google Maps<input name="link_mapa" type="url" defaultValue={emEdicao?.link_mapa ?? ""} className={CAMPO_P} placeholder="https://maps.app.goo.gl/…" /></label>
        <label className="grid gap-1 text-sm">Valor (R$)<input name="valor" inputMode="decimal" defaultValue={emEdicao?.valor ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Status<select name="status" defaultValue={emEdicao?.status ?? "captacao"} className={CAMPO_P}>
          {Object.entries(STATUS_IMOVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Área<input name="area" inputMode="decimal" defaultValue={emEdicao?.area ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Unidade<select name="area_unidade" defaultValue={emEdicao?.area_unidade ?? "m2"} className={CAMPO_P}>
          {Object.entries(UNIDADES_AREA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Quartos<input name="quartos" inputMode="numeric" defaultValue={emEdicao?.quartos ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Vagas<input name="vagas" inputMode="numeric" defaultValue={emEdicao?.vagas ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm md:col-span-2">Proprietário<select name="proprietario_id" defaultValue={emEdicao?.proprietario_id ?? ""} className={CAMPO_P}>
          <option value="">—</option>{(proprietarios.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          <Link href="/painel/escritorio/pessoas?tipo=proprietario" className="text-xs underline">Cadastrar proprietário</Link></label>
        <CampoResponsavel membros={s.membros} valor={emEdicao?.responsavel} equipe={s.espaco.equipe} />
        <label className="grid gap-1 text-sm md:col-span-4">Observações<textarea name="observacoes" rows={2} defaultValue={emEdicao?.observacoes ?? ""} className={CAMPO_P} /></label>
        <div className="flex flex-wrap gap-3 md:col-span-4">
          <button className={BOTAO_VERDE}>{emEdicao ? "Salvar alterações" : "Cadastrar imóvel"}</button>
          {emEdicao && <Link className={BOTAO} href={volta}>Cancelar</Link>}
          {emEdicao && <Link className={BOTAO} href={`/painel/escritorio/agenda?novo=1&imovel=${emEdicao.id}`}>Agendar visita</Link>}
        </div>
      </form>
      {emEdicao && <div className="mt-3"><BotaoExcluir tipo="imovel" id={emEdicao.id} volta={volta} /></div>}
    </details>

    <form className="mb-4 flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">Buscar<input name="q" defaultValue={busca} className={CAMPO_P} placeholder="Código, título, cidade" /></label>
      <label className="grid gap-1 text-sm">Status<select name="status" defaultValue={status} className={CAMPO_P}><option value="">Todos</option>
        {Object.entries(STATUS_IMOVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Tipo<select name="tipo" defaultValue={tipo} className={CAMPO_P}><option value="">Todos</option>
        {Object.entries(TIPOS_IMOVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button className={BOTAO}>Filtrar</button>
    </form>

    {imoveis.error && <p role="alert">Não foi possível carregar os imóveis.</p>}
    {!lista.length ? <p className="rounded-xl border border-dashed border-linha px-4 py-10 text-center text-texto-2">Nenhum imóvel {busca || status || tipo ? "com esse filtro" : "cadastrado ainda"}.</p>
      : <div className="cartao overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-linha text-left text-xs uppercase tracking-wider text-texto-2"><tr>
          <th className="px-3 py-2">Código</th><th className="px-3 py-2">Imóvel</th><th className="px-3 py-2">Local</th>
          <th className="px-3 py-2">Valor</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Proprietário</th>
          {s.espaco.equipe && <th className="px-3 py-2">Responsável</th>}</tr></thead>
        <tbody className="divide-y divide-linha">{lista.map((i) => <tr key={i.id} className="hover:bg-superficie-2/60">
          <td className="px-3 py-2 font-mono"><Link className="underline" href={`/painel/escritorio/imoveis?editar=${i.id}`}>{i.codigo}</Link></td>
          <td className="px-3 py-2">{i.titulo}<span className="block text-xs text-texto-2">{TIPOS_IMOVEL[i.tipo]} · {FINALIDADES[i.finalidade]}
            {i.area !== null && <> · {Number(i.area).toLocaleString("pt-BR")} {UNIDADES_AREA[i.area_unidade]}</>}</span></td>
          <td className="px-3 py-2">{[i.bairro, i.cidade].filter(Boolean).join(", ") || "—"}{i.link_mapa && <a className="block text-xs underline" href={i.link_mapa} target="_blank" rel="noreferrer">Mapa</a>}</td>
          <td className="px-3 py-2">{reais(i.valor)}</td>
          <td className="px-3 py-2">{STATUS_IMOVEL[i.status]}</td>
          <td className="px-3 py-2">{i.proprietario?.nome ?? "—"}</td>
          {s.espaco.equipe && <td className="px-3 py-2">{i.responsavel ? nome.get(i.responsavel) ?? "—" : "—"}</td>}
        </tr>)}</tbody></table></div>}
  </section>;
}
