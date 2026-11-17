import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import ImportarLeads from "@/components/crm-comercial/ImportarLeads";

/** Importação de leads em planilha (feira, lista de portal, carteira antiga). */
export default async function ImportarLeadsPagina() {
  await exigirSetor("comercial");
  return (
    <div className="max-w-4xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Importar leads"
        subtitulo={<>Cole ou envie uma planilha CSV (do Excel: “Salvar como CSV”). Colunas aceitas: <b>nome</b>, <b>telefone</b>, <b>email</b>,{" "}
          <b>imovel</b> (código AIB), <b>origem</b>, <b>mensagem</b>, <b>temperatura</b> e <b>etiquetas</b>. Até 500 linhas por vez.</>} />
      <ImportarLeads />
    </div>
  );
}
