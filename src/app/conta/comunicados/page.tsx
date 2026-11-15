import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

async function marcarLido(form: FormData) {
  "use server";
  const u = await currentUser();
  if (!u) redirect("/entrar?volta=/conta/comunicados");
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await supabaseAdmin()
    .from("matriz_entregas")
    .update({ lido_em: new Date().toISOString() })
    .eq("titular", u.id)
    .eq("comunicado", id)
    .is("lido_em", null);
  if (error) throw Error("Falha ao marcar o aviso como lido.");
  revalidatePath("/conta/comunicados");
  revalidatePath("/conta");
}

export default async function Avisos({ searchParams }: PageProps<"/conta/comunicados">) {
  const u = await currentUser();
  if (!u) redirect("/entrar?volta=/conta/comunicados");
  const n = Number((await searchParams).pagina),
    pagina = Number.isSafeInteger(n) && n >= 1 && n <= 10000 ? n : 1;
  const { data, error } = await supabaseAdmin()
    .from("matriz_entregas")
    .select("comunicado,lido_em,aviso:matriz_comunicados!inner(titulo,mensagem,criado_em)")
    .eq("titular", u.id)
    .order("aviso(criado_em)", { ascending: false })
    .order("comunicado")
    .range((pagina - 1) * 25, pagina * 25);
  if (error) throw Error("Falha ao carregar seus avisos.");
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-5">
      <Link href="/conta" className="underline">
        Minha conta
      </Link>
      <h1 className="lp-display text-3xl">Comunicados da Matriz</h1>
      {data.length === 0 && <p>Nenhum comunicado nesta página.</p>}
      {data.slice(0, 25).map((e) => {
        const a = e.aviso as unknown as { titulo: string; mensagem: string; criado_em: string };
        return (
          <article key={e.comunicado} className="cartao space-y-2 p-4">
            <h2 className="text-xl font-semibold">{a.titulo}</h2>
            <time>{new Date(a.criado_em).toLocaleDateString("pt-BR")}</time>
            <p className="whitespace-pre-wrap">{a.mensagem}</p>
            {!e.lido_em && (
              <form action={marcarLido}>
                <input type="hidden" name="id" value={e.comunicado} />
                <button className="btn-contorno px-4 py-2">Marcar como lido</button>
              </form>
            )}
          </article>
        );
      })}
      <nav className="flex gap-4">
        {pagina > 1 && <Link href={"?pagina=" + (pagina - 1)}>Anterior</Link>}
        {data.length > 25 && <Link href={"?pagina=" + (pagina + 1)}>Próxima</Link>}
      </nav>
    </main>
  );
}
