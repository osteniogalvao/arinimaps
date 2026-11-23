import Link from "next/link";
import { Inbox, Layers, ListChecks, TriangleAlert } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import CartografiaUpload from "./CartografiaUpload";
import ListaCamadas from "./ListaCamadas";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Cartao, Secao } from "@/components/ui/Pagina";

export default async function AdminCartografia() {
  await exigirSetor("cartografia");
  const admin = supabaseAdmin();
  const [{ data: municipios }, { data: divergentes }] = await Promise.all([
    admin.from("municipalities").select("id, nome, codigo_ibge").eq("ativo", true).order("nome"),
    // anúncios de lote que a troca de planta não conseguiu encaixar sozinha
    admin.from("properties").select("id, codigo, titulo, reencaixe_motivo, reencaixe_em")
      .eq("reencaixe_status", "divergente").order("reencaixe_em", { ascending: false }).limit(100),
  ]);

  return (
    <div className="mx-auto max-w-[1280px]">
      <CabecalhoPagina
        variante="simples"
        eyebrow="Central · Cartografia"
        titulo="Cartografia urbana"
        subtitulo="A planta da cidade entra como camada sobre o mapa e o satélite — quadras e lotes desenhados por cima da imagem real."
        acoes={
          <Link href="/admin/cartografia/solicitacoes" className="btn-contorno inline-flex items-center gap-2 px-4 py-2.5 text-sm">
            <Inbox className="size-4" /> Solicitações de planta
          </Link>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-12 min-w-0">
          <Secao eyebrow="Nova camada" titulo="Publicar planta">
            <CartografiaUpload municipios={municipios ?? []} />
          </Secao>

          <Secao eyebrow="Publicadas" titulo="Camadas no mapa">
            <ListaCamadas />
          </Secao>

          {!!divergentes?.length && (
            <Secao eyebrow="Troca de planta" titulo={`Anúncios para conferir (${divergentes.length})`}>
              <p className="mb-3 text-[0.95rem] text-texto-2">
                Estes anúncios não acharam com segurança o lote equivalente na planta nova — a divisa ficou como
                estava. Confira no imóvel e redesenhe a divisa, ou corrija a numeração da planta e reencaixe de novo.
              </p>
              <div className="cartao divide-y divide-linha">
                {divergentes.map((p) => (
                  <Link key={p.id} href={`/admin/imoveis/${p.id}`}
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-superficie-2/60">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-texto truncate">
                        <span className="font-mono text-sm text-texto-2">{p.codigo}</span> · {p.titulo}
                      </span>
                      <span className="block text-sm text-texto-2">{p.reencaixe_motivo}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Secao>
          )}
        </div>

        <aside className="lg:sticky lg:top-6">
          <Cartao className="space-y-4 bg-superficie-2">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-verde/12 text-verde">
                <ListChecks className="size-5" />
              </span>
              <p className="lp-display text-lg text-texto">Como preparar o arquivo</p>
            </div>
            <ol className="list-decimal ml-5 space-y-2.5 text-[0.95rem] leading-relaxed text-texto-2">
              <li>No AutoCAD, abra a planta e confirme que o desenho está em coordenadas do terreno (UTM).</li>
              <li>Salvar como → <strong className="text-texto">DXF</strong> (qualquer versão). O DWG é formato fechado e não pode ser lido direto.</li>
              <li>Suba o DXF aqui: linhas e quadras são convertidas e publicadas na hora.</li>
              <li>
                Se a planta aparecer deslocada, use <strong className="text-texto">Calibrar sobre o satélite</strong> — plantas antigas
                costumam estar em SAD 69, que fica ~66 m fora do lugar em relação ao GPS de hoje.
              </li>
            </ol>
            <div className="flex gap-3 border-t border-linha pt-4 text-sm leading-relaxed text-texto-2">
              <Layers className="mt-0.5 size-4 shrink-0 text-ouro" />
              <p>Também aceita imagem georreferenciada (GeoTIFF/PNG/JPG) — nesse caso os tiles são gerados pelo worker.</p>
            </div>
          </Cartao>
        </aside>
      </div>
    </div>
  );
}
