import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatArea } from "@/lib/format";
import Tour3D from "@/components/tour/Tour3D";
import { currentUser } from "@/lib/supabase/server";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { acessoDe } from "@/lib/planos-servidor";
import { direitosDoTour } from "@/lib/map/acesso-tour";

export const metadata: Metadata = { title: "Tour 3D" };

export default async function TourPage({ params, searchParams }: PageProps<"/imovel/[codigo]/tour">) {
  const { codigo } = await params;
  const sp = await searchParams;
  const record = sp.record === "1";
  const user = await currentUser();
  if (!user) {
    // O worker recebe um ingresso curto e exclusivo deste tour. A URL compartilhável não contém segredo.
    const ingresso = (await cookies()).get("arini_render")?.value ?? "";
    const [exp,mac] = ingresso.split(".");
    const chave = process.env.SAUDE_TOKEN;
    const esperado = chave && createHmac("sha256",chave).update("tour:"+codigo+":"+exp).digest("hex");
    if (!record || !esperado || !/^\d{13}$/.test(exp) || Number(exp)<Date.now() || !/^[a-f0-9]{64}$/.test(mac??"") || !timingSafeEqual(Buffer.from(mac),Buffer.from(esperado))) {
      redirect("/entrar?volta="+encodeURIComponent("/imovel/"+codigo+"/tour"));
    }
  }

  const { data } = await supabaseAdmin().rpc("fn_property_tour", { p_codigo: codigo });
  const tour = data as {
    codigo: string; titulo: string; tipo: "urbano" | "rural"; valor: number | null;
    geometry: GeoJSON.Geometry | null; centroid: { lng: number; lat: number } | null;
    area_m2: number | null;
    municipio: { nome: string; uf: string; sede_lng: number | null; sede_lat: number | null } | null;
    pois: { nome: string | null; categoria: string; lng: number; lat: number; distancia_m: number; destaque: boolean }[];
  } | null;
  if (!tour?.geometry || !tour.centroid) notFound();

  // §1.1: tour aberto vira evento do imóvel
  const {data:prop} = await supabaseAdmin().from("properties").select("id").eq("codigo",codigo).maybeSingle();
  if (prop?.id) void registrarEventoImovel({ propertyId: prop.id, tipo: "tour", userId: user?.id, detalhe: { codigo, record } });

  const acesso = user && !record ? await acessoDe(user.id) : null;
  return (
    <Tour3D
      codigo={tour.codigo}
      titulo={tour.titulo}
      valor={tour.valor}
      tipo={tour.tipo}
      areaLabel={formatArea(tour.area_m2, tour.tipo)}
      geometry={tour.geometry}
      centroid={tour.centroid}
      municipio={tour.municipio}
      pois={tour.pois ?? []}
      record={record}
      camadas={user && acesso ? await direitosDoTour(acesso, user.entradaAtiva, true) : null}
      medir={!acesso || acesso.recursos.has("ferramenta_medir")}
    />
  );
}
