import Link from "next/link";
import { exigirEquipe } from "@/lib/setores-servidor";
import { lerEquipe } from "@/lib/equipe-servidor";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import EquipeSetores from "@/components/admin/EquipeSetores";

export const metadata = { title: "Equipe e funções" };

/**
 * Funções e acessos por setor (migration 0161; áudios do Carlos, 23/11/2026
 * 17h58: "controle de funções" e "cada setor a gente tem que organizar para
 * liberar o acesso"). Toda a equipe vê quem está em cada setor e com qual
 * função (para saber a quem delegar); Diretoria e gestores organizam.
 */
export default async function EquipePorSetor() {
  const user = await exigirEquipe();
  const { pessoas, gere, diretoria, semMigration } = await lerEquipe(user);

  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      <CabecalhoPagina
        eyebrow="Central · Equipe"
        titulo="Equipe e funções"
        subtitulo={<>
          Quem trabalha em cada setor, com qual função e quem é o gestor. O gestor libera e retira o acesso do próprio setor e cria o login
          de quem entra nele; a Diretoria nomeia os gestores.
          {diretoria && <> Papel de Diretoria e desativação de conta ficam em <Link href="/admin/usuarios" className="font-semibold text-verde underline">Equipe e usuários</Link>;
            a recepção do WhatsApp, em <Link href="/admin/atendimento/configurar" className="font-semibold text-verde underline">Menu do WhatsApp e recepção</Link>.</>}
        </>}
      />
      {semMigration && (
        <p role="alert" className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm font-semibold text-alerta">
          Falta rodar a migration 0161 no Supabase. Até lá dá para ver e mudar os setores, mas não a função nem os gestores.
        </p>
      )}
      <EquipeSetores pessoas={pessoas} souEu={user.id} diretoria={diretoria} gere={gere} semMigration={semMigration} />
    </div>
  );
}
