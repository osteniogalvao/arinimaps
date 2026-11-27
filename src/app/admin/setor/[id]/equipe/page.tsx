import { notFound } from "next/navigation";
import { exigirSetor } from "@/lib/setores-servidor";
import { lerEquipe } from "@/lib/equipe-servidor";
import { SETOR_IDS, setorPorId, type SetorId } from "@/lib/setores";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import EquipeSetores from "@/components/admin/EquipeSetores";

export const metadata = { title: "Equipe do setor" };

/**
 * Equipe de UM setor, dentro do bloco do setor (áudio do Carlos, 26/11/2026
 * 22h02): cada setor tem o seu grupo; o gestor adiciona a pessoa por link ou
 * e-mail, ela cria a própria senha e só acessa as funções daquele grupo. A
 * Diretoria vê e organiza todos (Equipe e funções).
 */
export default async function EquipeDoSetor({ params }: PageProps<"/admin/setor/[id]/equipe">) {
  const { id: bruto } = await params;
  if (!SETOR_IDS.includes(bruto as SetorId) || bruto === "diretoria") notFound();
  const id = bruto as SetorId;
  const user = await exigirSetor(id);
  const setor = setorPorId(id)!;
  const { pessoas, gere, diretoria, semMigration } = await lerEquipe(user);
  const organiza = gere.includes(id);

  return (
    <div className="space-y-8">
      <CabecalhoPagina eyebrow={`Setor · ${setor.nome}`} titulo="Equipe do setor"
        subtitulo={organiza
          ? "Quem trabalha neste setor. Adicione pessoas por link ou com senha provisória: cada uma entra só nas telas deste setor."
          : "Quem trabalha neste setor e com qual função. Quem adiciona pessoas é o gestor do setor ou a Diretoria."} />
      <EquipeSetores pessoas={pessoas} souEu={user.id} diretoria={diretoria} gere={gere} semMigration={semMigration} setorUnico={id} />
    </div>
  );
}
