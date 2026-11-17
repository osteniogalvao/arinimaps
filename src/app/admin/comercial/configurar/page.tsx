import Link from "next/link";
import { Settings2 } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { Modelos, Motivos } from "@/components/crm-comercial/ConfigurarCrm";

/** Ajustes do CRM comercial: mensagens prontas e motivos de perda (migration 0147). */
export default async function ConfigurarCrm() {
  await exigirSetor("comercial");
  const admin = supabaseAdmin();
  const [modelos, motivos] = await Promise.all([
    admin.from("crm_modelos_mensagem").select("id, titulo, canal, assunto, texto, etapa, ativo, ordem").order("ordem").order("titulo"),
    admin.from("crm_motivos_perda").select("id, nome, ativo").order("ordem").order("nome"),
  ]);
  if (modelos.error || motivos.error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow="Comercial" titulo="Ajustes do CRM" />
        <Vazio icone={Settings2} titulo="Falta atualizar o banco" texto="Rode a migration 0147 (CRM comercial) para ligar as mensagens prontas e os motivos de perda." />
      </div>
    );
  }
  return (
    <div className="max-w-4xl space-y-10">
      <CabecalhoPagina eyebrow="Comercial" titulo="Ajustes do CRM"
        subtitulo={<>Mensagens prontas que o corretor envia pelo WhatsApp ou e-mail e os motivos de perda usados nos relatórios.
          O rodízio tem as regras em <Link href="/admin/rodizio" className="font-semibold text-verde hover:underline">Rodízio de leads</Link>.</>} />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-texto">Mensagens prontas</h2>
        <Modelos modelos={modelos.data ?? []} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-texto">Motivos de perda</h2>
        <p className="text-sm text-texto-2">Clique num motivo para desativar ou reativar. Motivos inativos somem da lista, mas continuam nos relatórios.</p>
        <Motivos motivos={motivos.data ?? []} />
      </section>
    </div>
  );
}
