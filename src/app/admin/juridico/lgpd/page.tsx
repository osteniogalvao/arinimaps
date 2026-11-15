import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import PedidosLgpd, { type Pedido } from "./PedidosLgpd";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import GuardasImovel, { type Guarda } from "./GuardasImovel";

/** Pedidos dos titulares de dados (LGPD, art. 18), com prazo e resposta registrada. */
export default async function AdminLgpd() {
  await exigirSetor("juridico");
  const db = supabaseAdmin();
  const [{ data },{ data: guardas, error: erroGuardas }] = await Promise.all([db.from("lgpd_requests")
    .select("id, codigo, nome, email, cpf, tipo, descricao, status, resposta, prazo, atendido_em, created_at")
    .order("created_at", { ascending: false }).limit(200),
    db.from("lgpd_guardas").select("id, fundamento, revisar_em, codigo_imovel, cofre_id").is("liberada_em",null).order("revisar_em"),
  ]);
  const ativas = (guardas ?? []) as Guarda[];
  const cofres = ativas.flatMap(g=>g.cofre_id ? [g.cofre_id] : []);
  const {data: docs} = cofres.length ? await db.from("cofre_documentos").select("propriedade_id,nome_arquivo,storage_path").in("propriedade_id",cofres) : {data:[]};

  return (
    <div className="space-y-6 max-w-5xl">
      <CabecalhoPagina eyebrow="Jurídico" titulo="Pedidos de titulares (LGPD)"
        subtitulo={<>
          Quem tem dados no sistema pode pedir acesso, correção, exclusão, portabilidade ou revogar o
          consentimento. Cada pedido tem prazo de 15 dias e a resposta fica registrada. Os pedidos chegam
          pela página de Suporte (categoria “Meus dados pessoais”) ou são lançados aqui.
        </>} />
      <PedidosLgpd pedidos={(data ?? []) as Pedido[]} />
      {erroGuardas ? <p role="alert">Não foi possível consultar as guardas.</p> : <GuardasImovel guardas={ativas.map(g=>({...g,documentos:docs?.filter(d=>d.propriedade_id===g.cofre_id)}))} />}
    </div>
  );
}
