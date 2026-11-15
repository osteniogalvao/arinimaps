import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NICHOS } from "@/lib/planos";
import Formulario from "./Formulario";

export default async function Comunicados() {
  await exigirSetor("marketing");
  const db = supabaseAdmin();
  const [planos, anteriores] = await Promise.all([
    db.from("plans").select("id,nome").eq("ativo", true).order("nome"),
    db
      .from("matriz_resumo_entregas")
      .select("id,titulo,criado_em,email,total,enviados,fila,conferir")
      .order("criado_em", { ascending: false })
      .limit(40),
  ]);
  if (planos.error || anteriores.error) throw Error("Falha ao carregar os comunicados.");
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <h1 className="lp-display text-3xl">Comunicados da Matriz</h1>
      <Formulario planos={planos.data} perfis={NICHOS.map((n) => ({ id: n.id, nome: n.nome }))} />
      <section>
        <h2 className="text-xl font-semibold">Últimos comunicados</h2>
        <ul>
          {anteriores.data.map((c) => (
            <li className="border-b border-linha py-2" key={c.id}>
              {c.titulo} · {c.total} destinatários · {new Date(c.criado_em).toLocaleDateString("pt-BR")}
              {c.email && (
                <p className="text-sm">
                  E-mails aceitos pelo provedor: {c.enviados} · Na fila: {c.fila} · A conferir: {c.conferir}
                </p>
              )}
              {c.conferir > 0 && (
                <p className="text-sm">
                  Confira o histórico no provedor pelo título e pela data antes de fazer novo envio.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
