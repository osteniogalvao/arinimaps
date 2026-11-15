import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import WhatsAppConversa from "@/components/crm/WhatsAppConversa";

export default async function CaixaWhatsapp({ searchParams }: PageProps<"/admin/comercial/whatsapp">) {
  await exigirSetor("comercial", "diretoria");
  const q = await searchParams;
  const pagina = Math.max(1, Math.min(100000, Math.trunc(Number(q.pagina) || 1)));
  const inicio = (pagina - 1) * 40;
  const { data, error } = await supabaseAdmin()
    .from("whatsapp_mensagens")
    .select("id,telefone,texto,opportunity_id,created_at")
    .eq("direcao", "entrada")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(inicio, inicio + 40);
  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="WhatsApp do Comercial" eyebrow="Central" />
      {typeof q.conversa === "string" && <WhatsAppConversa key={q.conversa} entrada={q.conversa} />}
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Mensagens recebidas</h2>
        {error && <p role="alert">Falha ao carregar a caixa de entrada.</p>}
        {data?.length === 0 && <p>Nenhuma mensagem nesta página.</p>}
        {data?.slice(0, 40).map((m) => (
          <Link
            key={m.id}
            className="cartao block p-4"
            href={
              m.opportunity_id
                ? "/admin/oportunidades/" + m.opportunity_id
                : "?conversa=" + m.id + "&pagina=" + pagina
            }
          >
            <span className="font-semibold">+{m.telefone}</span>
            <span className="ml-3 text-sm text-texto-2">
              {new Date(m.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            </span>
            <p className="truncate">{m.texto}</p>
          </Link>
        ))}
      </section>
      <nav aria-label="Páginas da caixa" className="flex gap-3">
        {pagina > 1 && (
          <Link className="underline" href={"?pagina=" + (pagina - 1)}>
            Anterior
          </Link>
        )}
        {(data?.length ?? 0) > 40 && (
          <Link className="underline" href={"?pagina=" + (pagina + 1)}>
            Próxima
          </Link>
        )}
      </nav>
    </div>
  );
}
