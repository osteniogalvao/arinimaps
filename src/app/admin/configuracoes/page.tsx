import { supabaseAdmin } from "@/lib/supabase/admin";
import { comPadroes } from "@/lib/configuracoes";
import { currentUser } from "@/lib/supabase/server";
import ConfiguracoesForm from "./ConfiguracoesForm";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Etiqueta, Secao } from "@/components/ui/Pagina";
import { CheckCircle2, CircleDashed, Plug } from "lucide-react";
import { provedorWhatsapp } from "@/lib/meta";

export default async function AdminConfiguracoes() {
  await exigirSetor("diretoria");
  const [{ data }, user] = await Promise.all([
    supabaseAdmin().from("settings").select("chave, valor"),
    currentUser(),
  ]);

  // integrações vêm de variável de ambiente (chave nunca no navegador):
  // aqui a tela só mostra se estão ligadas.
  const integracoes = [
    { nome: "Resend (e-mails automáticos)", ligado: !!process.env.RESEND_API_KEY,
      dica: "Sem isso, leads e avisos ficam só no painel." },
    { nome: "Asaas (cobrança)", ligado: !!process.env.ASAAS_API_KEY,
      dica: "Habilita “Cobrar via Asaas” nas faturas." },
    { nome: "Esri ArcGIS (satélite licenciado)", ligado: !!process.env.NEXT_PUBLIC_ARCGIS_KEY,
      dica: "Sem isso, o satélite usa a fonte de demonstração, sem licença comercial." },
    { nome: "WhatsApp (" + (provedorWhatsapp() === "meta" ? "Meta Cloud API" : "Evolution API") + ")", ligado: provedorWhatsapp() !== null,
      dica: "Sem isso, o CRM não conversa pelo WhatsApp e o atendimento automático fica desligado. Conexão em Central › WhatsApp › Conexão do número." },
    { nome: "Anthropic (assistente de IA)", ligado: !!process.env.ANTHROPIC_API_KEY,
      dica: "Sem isso, o assistente aparece como “em configuração” e a rota responde 503." },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-12">
      <CabecalhoPagina
        variante="simples"
        eyebrow="Central · Diretoria"
        titulo="Configurações do sistema"
        subtitulo="O que você mudar aqui vale imediatamente no site, no mapa e nas regras comerciais."
      />

      <ConfiguracoesForm
        inicial={comPadroes(data ?? [])}
        ehDiretoria={user?.role === "admin_central"}
      />

      <Secao
        eyebrow="Servidor"
        titulo="Integrações"
        subtitulo="Configuradas no servidor por segurança (as chaves nunca chegam ao navegador). Peça ao desenvolvedor para ligar as que faltam."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {integracoes.map((i) => (
            <div key={i.nome} className={"cartao flex items-start gap-4 border-l-4 p-5 " + (i.ligado ? "border-l-verde" : "border-l-linha-forte")}>
              <span className={"grid size-10 shrink-0 place-items-center rounded-xl " + (i.ligado ? "bg-verde/12 text-verde" : "bg-superficie-2 text-texto-2")}>
                <Plug className="size-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-texto">{i.nome}</p>
                  <Etiqueta tom={i.ligado ? "verde" : "neutro"}>
                    {i.ligado ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                    {i.ligado ? "ligada" : "não configurada"}
                  </Etiqueta>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-texto-2">{i.dica}</p>
              </div>
            </div>
          ))}
        </div>
      </Secao>
    </div>
  );
}
