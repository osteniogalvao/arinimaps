"""Converte o Anexo A privado em registros para fn_importar_matriz_personas(jsonb).

Uso: python scripts/preparar-matriz-personas.py anexo.xlsx arquivo-privado.json
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import posixpath
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile


NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
PERSONAS = ("proprietario", "corretor_imobiliaria", "produtor_rural", "engenheiro",
            "comprador_investidor", "leiloeiro", "ente_publico", "empresa_holding",
            "quero_vender", "correspondente_bancario")
DISPOSICOES = {
    "Produto": "F", "Plataforma (segurança e permissões)": "I", "Backoffice ARINI": "I",
    "Integração": "X", "Fora do escopo (estratégico)": "I", "Negócio (fora do software)": "N",
}


def ler_abas(caminho):
    with ZipFile(caminho) as arquivo:
        compartilhadas = []
        if "xl/sharedStrings.xml" in arquivo.namelist():
            strings = ET.fromstring(arquivo.read("xl/sharedStrings.xml"))
            compartilhadas = ["".join(t.text or "" for t in si.findall(".//s:t", NS)) for si in strings]
        vinculos = {r.get("Id"): r.get("Target") for r in
                    ET.fromstring(arquivo.read("xl/_rels/workbook.xml.rels"))}
        livro = ET.fromstring(arquivo.read("xl/workbook.xml"))
        for aba in livro.findall("s:sheets/s:sheet", NS):
            destino = vinculos[aba.get(REL)]
            parte = destino.lstrip("/") if destino.startswith("/") else posixpath.join("xl", destino)
            xml = ET.fromstring(arquivo.read(parte))
            linhas = []
            for linha in xml.findall("s:sheetData/s:row", NS):
                valores = {}
                for celula in linha.findall("s:c", NS):
                    coluna = re.match(r"[A-Z]+", celula.get("r")).group()
                    valor = celula.findtext("s:v", "", NS)
                    if celula.get("t") == "s":
                        valor = compartilhadas[int(valor)]
                    elif celula.get("t") == "inlineStr":
                        valor = "".join(t.text or "" for t in celula.findall(".//s:t", NS))
                    valores[coluna] = valor
                linhas.append(valores)
            yield aba.get("name"), linhas


def converter(caminho):
    abas = dict(ler_abas(caminho))
    canonicos = {}
    for linha in abas["Duplicados"][1:]:
        for repetido in linha["B"].split(","):
            canonicos[int(repetido)] = int(linha["A"])
    futuros = {int(linha["A"]) for linha in abas["Itens futuros"][1:]}
    cabecalho, *linhas = abas["Matriz"]
    colunas = "GHIJKLMNOP"
    if [cabecalho[c].split()[0] for c in colunas] != [f"P{i}" for i in range(1, 11)]:
        raise ValueError("Ordem de personas inválida no anexo.")
    itens = []
    for linha in linhas:
        item = int(linha["A"])
        niveis = {p: linha[c] for p, c in zip(PERSONAS, colunas, strict=True)}
        if any(v not in {"C", "L", "O", "P", "M", "G", "-"} for v in niveis.values()):
            raise ValueError(f"Nível de acesso inválido no item {item}")
        itens.append(dict(id=item, titulo=linha["D"], natureza=DISPOSICOES[linha["E"]],
                          modulo=linha["B"], subsecao=linha["C"], permissoes=niveis,
                          disposicao=linha["E"], fase=linha["F"], observacoes=linha.get("Q") or None,
                          canonico=canonicos.get(item), futuro=item in futuros))
    if Counter(i["id"] for i in itens) != Counter(range(1, 916)):
        raise ValueError("O Anexo A deve conter cada item de 1 a 915 exatamente uma vez.")
    return itens


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("anexo", type=Path)
    parser.add_argument("saida", type=Path)
    args = parser.parse_args()
    if args.saida.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error("Salve o inventário confidencial fora do repositório.")
    args.saida.write_text(json.dumps(converter(args.anexo), ensure_ascii=False), encoding="utf-8")
