// Anúncio só nos municípios atendidos (áudio do Carlos, 17/11/2026 19h09).
// Uso: node scripts/testa-municipios-atendidos.ts   (sem servidor nem banco)
import assert from "node:assert/strict";
import { ibgeDoCar, listaDeMunicipios, municipioAtendidoDoCar, type MunicipioAtendido } from "../src/lib/geo/atendimento.ts";

const lista: MunicipioAtendido[] = [
  { id: "a", nome: "Iturama", uf: "MG", codigo_ibge: "3134400" },
  { id: "b", nome: "União de Minas", uf: "MG", codigo_ibge: "3170479" },
  { id: "c", nome: "Limeira do Oeste", uf: "MG", codigo_ibge: "3138625" },
];

assert.equal(ibgeDoCar("MG-3134400-F0B5DB13248140BBAE3B90AD7E6F4A53"), "3134400");
assert.equal(ibgeDoCar(" mg-3134400-abc "), "3134400");
assert.equal(ibgeDoCar("qualquer coisa"), null);
assert.equal(ibgeDoCar(null), null);

// pelo código do CAR
assert.equal(municipioAtendidoDoCar(lista, { cod: "MG-3134400-XYZ", municipio: "Iturama" })?.id, "a");
assert.equal(municipioAtendidoDoCar(lista, { cod: "SP-3550308-XYZ", municipio: "São Paulo" }), null);
// o código manda mesmo quando o nome coincide com um atendido
assert.equal(municipioAtendidoDoCar(lista, { cod: "GO-5208707-XYZ", municipio: "Iturama" }), null);
// sem código, o nome (sem acento, sem UF) decide
assert.equal(municipioAtendidoDoCar(lista, { cod: "", municipio: "Uniao de Minas/MG" })?.id, "b");
assert.equal(municipioAtendidoDoCar(lista, { cod: null, municipio: "Frutal" }), null);
assert.equal(municipioAtendidoDoCar(lista, {}), null);

assert.equal(listaDeMunicipios(lista), "Iturama, União de Minas e Limeira do Oeste");
assert.equal(listaDeMunicipios(lista.slice(0, 1)), "Iturama");

console.log("ok: anúncio limitado aos municípios atendidos");
