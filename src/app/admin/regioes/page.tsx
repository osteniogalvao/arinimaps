import { supabaseAdmin } from "@/lib/supabase/admin";
import AdicionarMunicipio from "./AdicionarMunicipio";
import ConfereSatelite from "./ConfereSatelite";
import AtualizarCar from "./AtualizarCar";
import { exigirSetor } from "@/lib/setores-servidor";
import { Globe, MapPin, Tractor } from "lucide-react";
import { CabecalhoPagina, Cartao, Estatistica, Etiqueta, Secao } from "@/components/ui/Pagina";

export default async function AdminRegioes() {
  await exigirSetor("cartografia");
  const admin = supabaseAdmin();
  const [{ data: regioes }, { data: municipios }, { data: car }] = await Promise.all([
    admin.from("regions").select("id, nome, ativa").order("nome"),
    admin.from("municipalities").select("id, nome, uf, codigo_ibge, ativo, region:regions(nome)").order("nome"),
    admin.rpc("fn_car_resumo"),
  ]);
  const carPorIbge = new Map(
    ((car ?? []) as { codigo_ibge: string; imoveis: number; importado_em: string | null }[])
      .map((c) => [String(c.codigo_ibge), c])
  );
  const ultimaImportacao = [...carPorIbge.values()]
    .map((c) => c.importado_em).filter(Boolean).sort().pop();

  const lista = municipios ?? [];
  const totalCar = lista.reduce((t, m) => t + (carPorIbge.get(String(m.codigo_ibge))?.imoveis ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1280px] space-y-12">
      <CabecalhoPagina
        variante="simples"
        eyebrow="Central · Cartografia"
        titulo="Regiões e municípios"
        subtitulo="A estrutura já suporta múltiplas regiões (expansão/franquias). A primeira versão opera na região piloto."
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <Estatistica icone={Globe} valor={(regioes ?? []).filter((r) => r.ativa).length} rotulo="Regiões ativas" />
        <Estatistica icone={MapPin} valor={lista.length} rotulo="Municípios no mapa" />
        <Estatistica icone={Tractor} valor={<span className="tabular-nums">{totalCar.toLocaleString("pt-BR")}</span>} rotulo="Imóveis rurais do CAR" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <Secao eyebrow="Expansão" titulo="Regiões">
          <Cartao padding="p-2">
            <ul className="divide-y divide-linha">
              {(regioes ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3.5 text-[0.95rem]">
                  <span className="font-semibold text-texto">{r.nome}</span>
                  <Etiqueta tom={r.ativa ? "verde" : "neutro"}>{r.ativa ? "ativa" : "inativa"}</Etiqueta>
                </li>
              ))}
            </ul>
          </Cartao>
        </Secao>

        <Secao eyebrow="Malha do IBGE" titulo="Municípios no mapa"
          subtitulo="O anúncio (“Esta área é minha”) só abre nestes municípios. Na expansão, adicione o município aqui e ele fica liberado.">
          <Cartao className="space-y-5">
            <AdicionarMunicipio />
            <div className="-mx-6 -mb-6 overflow-x-auto border-t border-linha">
              <table className="w-full min-w-[560px] text-[0.95rem]">
                <thead className="bg-superficie-2 text-left text-[11px] font-semibold uppercase tracking-wider text-texto-2">
                  <tr>
                    <th className="px-6 py-3">Município</th>
                    <th className="px-3 py-3">IBGE</th>
                    <th className="px-3 py-3 text-right">Imóveis no CAR</th>
                    <th className="px-6 py-3">Região</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {lista.map((m) => (
                    <tr key={m.id} className="transition-colors hover:bg-superficie-2/60">
                      <td className="px-6 py-3.5 font-semibold text-texto">{m.nome} <span className="font-normal text-texto-2">· {m.uf}</span></td>
                      <td className="px-3 py-3.5 font-mono text-sm text-texto-2">{m.codigo_ibge}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-texto">
                        {(carPorIbge.get(String(m.codigo_ibge))?.imoveis ?? 0).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-6 py-3.5 text-texto-2">{(m.region as unknown as { nome: string } | null)?.nome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </Secao>
      </div>

      <Secao
        eyebrow="SICAR"
        titulo="Imóveis rurais do CAR"
        subtitulo={<>
          A malha do SICAR aparece no mapa para o proprietário clicar na área dele e anunciar. Ela é
          copiada para o sistema (o mapa não depende do SICAR estar no ar) e atualizada por este botão —
          vale rodar uma vez por mês. Município novo já entra com o CAR.
          {ultimaImportacao && <> Última atualização: <strong className="text-texto tabular-nums">{new Date(ultimaImportacao).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</strong>.</>}
        </>}
      >
        <Cartao>
          <AtualizarCar />
        </Cartao>
      </Secao>

      <ConfereSatelite />
    </div>
  );
}
