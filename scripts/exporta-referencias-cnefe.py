"""Gera o SQL de importação de referências urbanas do Censo 2022 por município.
Uso: python scripts/exporta-referencias-cnefe.py saida.sql 3134400:Iturama 3170438:"União de Minas"
Os códigos precisam existir em municipalities. Não exporta números de casa, moradores ou estabelecimentos.
"""
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

BASE = "https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/"
VIAS = {"RUA", "AVENIDA", "PRACA", "TRAVESSA", "ALAMEDA", "VIELA", "VIA", "LARGO", "BECO", "LADEIRA", "BOULEVARD"}


def normalizar(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def referencias(codigo, municipio):
    if not re.fullmatch(r"\d{7}", codigo):
        raise ValueError("Código IBGE inválido")
    indice = urllib.request.urlopen(BASE, timeout=30).read().decode("latin-1")
    uf = re.search(r'href="(' + codigo[:2] + r'_[A-Z]{2}/)"', indice).group(1)
    arquivos = urllib.request.urlopen(BASE + uf, timeout=30).read().decode("latin-1")
    nome_zip = re.search(r'href="(' + codigo + r'_[^"/]+\.zip)"', arquivos).group(1)
    grupos = defaultdict(list)
    with urllib.request.urlopen(BASE + uf + nome_zip, timeout=45) as resposta:
        with zipfile.ZipFile(io.BytesIO(resposta.read())) as z, z.open(z.namelist()[0]) as arquivo:
            leitor = csv.DictReader(io.TextIOWrapper(arquivo, encoding="utf-8-sig"), delimiter=";")
            for row in leitor:
                tipo = row["NOM_TIPO_SEGLOGR"].strip()
                if tipo not in VIAS or not row["NOM_SEGLOGR"].strip():
                    continue
                try:
                    lat, lng = float(row["LATITUDE"]), float(row["LONGITUDE"])
                except ValueError:
                    continue
                if not (-35 < lat < 6 and -74 < lng < -32):
                    continue
                ponto = (lng, lat)
                via = " ".join(filter(None, (tipo, row["NOM_TITULO_SEGLOGR"], row["NOM_SEGLOGR"]))).title()
                local = row["DSC_LOCALIDADE"].strip().title()
                grupos["Logradouro", via, local].append(ponto)
                if local:
                    grupos["Localidade", local, ""].append(ponto)
                quadra = row["NUM_QUADRA"].strip()
                if quadra and quadra != "0":
                    grupos["Quadra censitária", "Quadra censitária " + quadra, local + " · setor " + row["COD_SETOR"]].append(ponto)
                for i in range(1, 6):
                    elemento, valor = row[f"NOM_COMP_ELEM{i}"], row[f"VAL_COMP_ELEM{i}"].strip()
                    if elemento in ("QUADRA", "LOTE") and re.fullmatch(r"[0-9]{1,6}[A-Za-z]?", valor):
                        grupos[elemento.title(), elemento.title() + " " + valor, via + " · " + local].append(ponto)
    if not grupos:
        raise ValueError("O arquivo não contém referências urbanas: " + codigo)
    for (tipo, nome, contexto), pontos in sorted(grupos.items()):
        # Representa a área com um ponto observado próximo da média.
        x = sum(p[0] for p in pontos) / len(pontos)
        y = sum(p[1] for p in pontos) / len(pontos)
        lng, lat = min(pontos, key=lambda p: (p[0]-x)**2 + (p[1]-y)**2)
        busca = " ".join((nome, contexto, municipio, "bairro" if tipo == "Localidade" else tipo))
        yield dict(tipo=tipo, nome=nome, contexto=contexto, busca=normalizar(busca), lng=lng, lat=lat)


def literal(valor):
    return "'" + valor.replace("'", "''") + "'"


def main():
    saida, *municipios = sys.argv[1:]
    if not municipios:
        raise ValueError("Informe código:nome de pelo menos um município")
    with Path(saida).open("w", encoding="utf-8", newline="\n") as f:
        f.write("begin;\n")
        for spec in municipios:
            codigo, municipio = spec.split(":", 1)
            rows = list(referencias(codigo, municipio))
            f.write(f"delete from public.referencias_urbanas where municipio={literal(codigo)};\n")
            for i in range(0, len(rows), 400):
                lote = literal(json.dumps(rows[i:i+400], ensure_ascii=False))
                f.write(f"insert into public.referencias_urbanas select {literal(codigo)},tipo,nome,contexto,to_tsvector('simple',busca),lng,lat from jsonb_to_recordset({lote}::jsonb) x(tipo text,nome text,contexto text,busca text,lng float8,lat float8);\n")
            print(codigo, municipio, len(rows))
        f.write("commit;\n")


if __name__ == "__main__":
    main()
