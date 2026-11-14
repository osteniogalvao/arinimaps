import { createClient } from "@supabase/supabase-js";

// Ao excluir um anexo, imóvel ou conta, a FK remove o metadado e o gateway
// deixa de assinar imediatamente. Também recolhe uploads interrompidos entre
// Storage e Postgres. A carência protege o arquivo que acabou de ser enviado.
export async function limparCofre(_payload, db, _job, storage) {
  let cursor = "";
  for (;;) {
    const { rows } = await db.query(`
      select o.name from storage.objects o
      where o.bucket_id='docs' and o.name > $1
        and o.created_at < now() - interval '2 hours'
        and (
          (o.name like 'cofre/%' and not exists (select 1 from public.cofre_documentos d where d.storage_path=o.name))
          or (o.name like 'raster/%' and not exists (select 1 from public.cartography_layers c where c.tipo='raster' and c.source_path=o.name))
        )
      order by o.name limit 100`, [cursor]);
    if (!rows.length) break;
    storage ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession:false } }).storage.from("docs");
    const { error } = await storage.remove(rows.map(o => o.name));
    if (error) throw new Error("Falha ao remover anexos excluídos do cofre: " + error.message);
    cursor = rows.at(-1).name;
  }
}
