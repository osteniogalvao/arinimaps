import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import ChatInterno from "@/components/chat/ChatInterno";

export const metadata = { title: "Chat da equipe" };

/** Chat interno da equipe (0159): conversas diretas e um canal por setor. */
export default async function Chat({ searchParams }: PageProps<"/admin/chat">) {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!a.ehArini) redirect("/");
  const q = await searchParams;
  const inicial = typeof q.c === "string" && /^[0-9a-f-]{36}$/i.test(q.c) ? q.c : null;
  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="Chat da equipe" eyebrow="Central" subtitulo="Conversa direta com qualquer pessoa da equipe e um canal para cada setor em que você atua." />
      <ChatInterno inicial={inicial} />
    </div>
  );
}
