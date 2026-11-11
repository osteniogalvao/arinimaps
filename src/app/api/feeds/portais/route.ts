import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes, texto } from "@/lib/settings";

/**
 * Feed XML para portais imobiliários (formato VRSync, aceito pelo Grupo ZAP,
 * OLX e outros que leem o mesmo padrão). Entram os imóveis com publicação
 * "Portais" ativa na Central de publicação e anúncio no ar. O portal lê esta
 * URL de tempos em tempos; tirar a publicação tira o imóvel na leitura seguinte.
 */
export const dynamic = "force-dynamic";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TIPO_VRSYNC: Record<string, string> = { rural: "Residential / Farm Ranch", urbano: "Residential / Land Lot" };

export async function GET() {
  const admin = supabaseAdmin();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br";
  const midia = (p: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${p}`;
  const cfg = await lerConfiguracoes();
  const { data: pubs } = await admin.from("publicacoes").select("property_id").eq("canal", "portais").eq("status", "publicada");
  const ids = [...new Set((pubs ?? []).map((p) => p.property_id))];
  const { data: imoveis } = ids.length ? await admin.from("properties")
    .select("id, codigo, titulo, descricao, tipo, valor, area_declarada, updated_at, municipio:municipalities(nome, uf), media:property_media(storage_path, capa, ordem, tipo)")
    .in("id", ids).in("status", ["publicado", "em_negociacao"]) : { data: [] };

  const listagens = (imoveis ?? []).map((p) => {
    const mun = p.municipio as unknown as { nome: string; uf: string } | null;
    const fotos = ((p.media ?? []) as { storage_path: string; capa: boolean; ordem: number; tipo: string }[])
      .filter((m) => m.tipo === "foto").sort((a, b) => Number(b.capa) - Number(a.capa) || a.ordem - b.ordem).slice(0, 30);
    const areaM2 = p.area_declarada ? (p.tipo === "rural" ? Number(p.area_declarada) * 10_000 : Number(p.area_declarada)) : null;
    return `  <Listing>
    <ListingID>${esc(p.codigo)}</ListingID>
    <Title><![CDATA[${String(p.titulo ?? "").replace(/]]>/g, "")}]]></Title>
    <TransactionType>For Sale</TransactionType>
    <DetailViewUrl>${esc(`${site}/imovel/${p.codigo}`)}</DetailViewUrl>
    <ListDate>${esc(new Date(p.updated_at).toISOString())}</ListDate>
    <Media>
${fotos.map((f, i) => `      <Item medium="image" caption="${esc(p.codigo)}"${i === 0 ? ' primary="true"' : ""}>${esc(midia(f.storage_path))}</Item>`).join("\n")}
    </Media>
    <Details>
      <PropertyType>${TIPO_VRSYNC[p.tipo] ?? "Residential / Land Lot"}</PropertyType>
      <Description><![CDATA[${String(p.descricao ?? "").replace(/]]>/g, "")}]]></Description>
      ${p.valor ? `<ListPrice currency="BRL">${Math.round(Number(p.valor))}</ListPrice>` : ""}
      ${areaM2 ? `<LotArea unit="square metres">${Math.round(areaM2)}</LotArea>` : ""}
    </Details>
    <Location displayAddress="Neighborhood">
      <Country abbreviation="BR">Brasil</Country>
      <State abbreviation="${esc(mun?.uf ?? "MG")}">${esc(mun?.uf ?? "MG")}</State>
      <City>${esc(mun?.nome ?? "")}</City>
    </Location>
    <ContactInfo>
      <Name>Arini Negócios Imobiliários</Name>
      <Email>${esc(texto(cfg, "email_contato", ""))}</Email>
      <Telephone>${esc(texto(cfg, "telefone_contato", ""))}</Telephone>
      <Website>${esc(site)}</Website>
    </ContactInfo>
  </Listing>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <Provider>Arini Imóveis Brasil</Provider>
    <Email>${esc(texto(cfg, "email_contato", ""))}</Email>
    <ContactName>Arini Negócios Imobiliários</ContactName>
    <PublishDate>${new Date().toISOString()}</PublishDate>
  </Header>
  <Listings>
${listagens.join("\n")}
  </Listings>
</ListingDataFeed>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
