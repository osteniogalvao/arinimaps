import { area } from "@turf/area";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { buscarSigef, nomeRuralValido } from "@/lib/geo/sigef";

const LIMITE = 15;
export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const q = new URL(request.url).searchParams, nome = (q.get("nome") ?? "").trim();
  const municipio = q.get("municipio"), bbox = (q.get("bbox") ?? "").split(",").map(Number);
  if (nome && !nomeRuralValido(nome)) return Response.json({ error:"Use de 3 a 80 caracteres do nome do imóvel." }, { status:400 });
  if (municipio !== null && !/^\d{7}$/.test(municipio)) return Response.json({ error:"Informe o código do município escolhido." }, { status:400 });
  const [xmin,ymin,xmax,ymax] = bbox;
  if (!municipio && (!nome || bbox.length !== 4 || !bbox.every(Number.isFinite) ||
    xmin < -80 || xmax > -28 || ymin < -38 || ymax > 9 || xmin >= xmax || ymin >= ymax || xmax-xmin > 2 || ymax-ymin > 2)) {
    return Response.json({ error:"Aproxime o mapa da região desejada ou selecione o município para comparar." }, { status:422 });
  }
  try {
    const local = municipio ? { municipio:Number(municipio) } : { bbox:{ xmin, ymin, xmax, ymax } };
    const { features } = await buscarSigef({ ...local, nome, max:LIMITE+1, geometria:true });
    const parcelas = features.slice(0,LIMITE).flatMap(({ properties:p, geometry }) => {
      if (!geometry || !p.parcela_codigo) return [];
      return [{
        id:String(p.parcela_codigo), nome:String(p.nome_area || "Parcela sem denominação"),
        matricula:p.registro_matricula == null ? null : String(p.registro_matricula),
        municipio:Number(p.municipio_id), areaHa:area(geometry)/10_000, geometria:geometry,
      }];
    });
    return Response.json({ parcelas, mais:features.length>LIMITE, fonte:"INCRA / SIGEF" }, {
      headers:{ "Cache-Control":"public, max-age=3600, s-maxage=3600" },
    });
  } catch {
    return Response.json({ error:"O Geoportal do INCRA não respondeu. Tente novamente." }, { status:502 });
  }
}
