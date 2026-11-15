// Gera a carga municipal a partir do shapefile de pontos e da projeção publicada pela FBDS.
// node scripts/exportar-nascentes-fbds.mjs arquivo.json
import { writeFile } from "node:fs/promises";
import proj4 from "proj4";

const municipios = ["ITURAMA", "LIMEIRA_DO_OESTE", "UNIAO_DE_MINAS", "CARNEIRINHO", "CAMPINA_VERDE", "SAO_FRANCISCO_DE_SALES"];
async function obter(url) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!resposta.ok) throw new Error(`FBDS ${resposta.status} em ${url}`);
  return resposta;
}
async function municipio(nome) {
  const pasta = `https://geo.fbds.org.br/MG/${nome}/HIDROGRAFIA/`;
  const indice = await (await obter(pasta)).text();
  const arquivo = /MG_(\d{7})_NASCENTES\.shp(?=")/i.exec(indice);
  if (!arquivo) throw new Error(`Sem shapefile de nascentes em ${nome}`);
  const url = pasta + arquivo[0];
  const [resposta, projecao] = await Promise.all([obter(url), obter(url.replace(/\.shp$/i, ".prj"))]);
  const transformar = proj4(await projecao.text(), "EPSG:4326");
  const dados = Buffer.from(await resposta.arrayBuffer());
  if (dados.readInt32BE(0) !== 9994 || dados.readInt32LE(32) !== 1 || dados.readInt32BE(24)*2 !== dados.length) throw Error("Shapefile de pontos inválido");
  const pontos = [];
  for (let i = 100; i < dados.length;) {
    const tamanho = dados.readUInt32BE(i+4)*2;
    const tipo = dados.readUInt32LE(i+8);
    if (i+8+tamanho > dados.length || (tipo !== 0 && (tipo !== 1 || tamanho !== 20))) throw Error("Registro de ponto inválido");
    if (tipo === 1) {
      const [lng, lat] = transformar.forward([dados.readDoubleLE(i+12), dados.readDoubleLE(i+20)]);
      if (!(lng > -52 && lng < -47 && lat > -22 && lat < -17)) throw Error("Ponto fora da região");
      pontos.push([Number(lng.toFixed(7)), Number(lat.toFixed(7))]);
    }
    i += 8+tamanho;
  }
  if (!pontos.length) throw Error(`Arquivo vazio em ${nome}`);
  console.log(nome, pontos.length);
  return { ibge: Number(arquivo[1]), fonte: url, pontos };
}
if (!process.argv[2]) throw Error("Informe o caminho do JSON de saída.");
await writeFile(process.argv[2], JSON.stringify(await Promise.all(municipios.map(municipio))));
