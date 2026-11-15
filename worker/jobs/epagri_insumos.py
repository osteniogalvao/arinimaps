"""Preços médios estaduais pagos pelo produtor, por mês de referência da Epagri/Cepa."""
from datetime import date
import math
import re

from epagri_xlsx import MESES, PAGINA, linhas


# Código, grupo e unidade constam da aba de séries ativas. O mesmo nome pode
# designar semente, ração ou grão em levantamentos diferentes.
ITENS = {
    "177": ("Alimentos para animais", "Farelo de soja", "kg"),
    "216": ("Animais", "Bovino corte novilha PC", "cabeça"),
    "227": ("Animais", "Bovino leite novilha PC - Holandesa", "cabeça"),
    "228": ("Animais", "Bovino leite novilha PC - Jersey", "cabeça"),
    "277": ("Combustíveis, lubrificantes e filtros", "Diesel", "l"),
    "352": ("Fertilizantes e correlatos", "Adubo 00-20-30", "sc 50 kg"),
    "355": ("Fertilizantes e correlatos", "Adubo 04-14-08", "sc 50 kg"),
    "383": ("Fertilizantes e correlatos", "Cloreto de potássio", "sc 50 kg"),
    "396": ("Fertilizantes e correlatos", "Superfosfato simples", "sc 50 kg"),
    "397": ("Fertilizantes e correlatos", "Superfosfato triplo", "sc 50 kg"),
    "399": ("Fertilizantes e correlatos", "Uréia 45%", "sc 50 kg"),
    "789": ("Sementes", "Aveia preta", "kg"),
    "830": ("Sementes", "Trigo", "sc 40 kg"),
    "1008": ("Fertilizantes e correlatos", "Calcário calcítico granel", "t"),
    "1009": ("Fertilizantes e correlatos", "Calcário dolomítico granel", "t"),
}

ABREVIATURAS = {nome[:3]: mes for mes, nome in enumerate(MESES, start=1)}


def periodos_da_folha(cabecalho, inicio, hoje):
    periodos = {}
    vistos = set()
    for coluna, texto in cabecalho.items():
        resultado = re.fullmatch(r"([a-z]{3})_(\d{4})\s*(\(\*\))?", texto.strip().lower())
        if not resultado:
            continue
        mes = ABREVIATURAS.get(resultado[1])
        if not mes:
            raise ValueError(f"mês desconhecido na planilha Epagri de insumos: {texto}")
        competencia = date(int(resultado[2]), mes, 1)
        if competencia in vistos:
            raise ValueError(f"competência repetida na planilha Epagri de insumos: {texto}")
        vistos.add(competencia)
        if inicio <= competencia <= hoje:
            periodos[coluna] = (competencia.isoformat(), bool(resultado[3]))
    return periodos


def ler(planilha, inicio, hoje):
    aba_ativa = False
    periodos = None
    resultado = []
    vistos = set()
    for linha in linhas(planilha):
        if linha.get("E") == "Preços Médios de Insumos e Fatores de Produção de Santa Catarina":
            aba_ativa = True
        if aba_ativa and (linha.get("D"), linha.get("E"), linha.get("F")) == ("Grupo", "Produto", "Unidade"):
            periodos = periodos_da_folha(linha, inicio, hoje)
            continue
        codigo = linha.get("B")
        if codigo not in ITENS or periodos is None:
            continue
        grupo, nome, unidade = ITENS[codigo]
        if codigo in vistos or (linha.get("D"), linha.get("E"), linha.get("F")) != (grupo, nome, unidade):
            raise ValueError(f"identificação ou unidade alterada no insumo Epagri de código {codigo}")
        vistos.add(codigo)
        observacoes = []
        for coluna, (dia, provisorio) in periodos.items():
            texto = linha.get(coluna, "").strip()
            if texto in ("", "...", "-", "…"):
                continue
            valor = float(texto)
            if not math.isfinite(valor) or valor <= 0:
                raise ValueError(f"valor inválido no insumo Epagri {codigo} em {dia}")
            observacoes.append((dia, round(valor, 4), provisorio))
        if not observacoes:
            continue
        observacoes.sort()
        descricao = "Preço médio pago pelo produtor em Santa Catarina. A data identifica o mês de referência do levantamento."
        if observacoes[-1][2]:
            descricao += " O valor mais recente está sujeito a revisão pela Epagri/Cepa."
        resultado.append({
            "serie": {
                "slug": f"epagri-sc-insumo-{codigo}-sc",
                "produto": "novilhas" if grupo == "Animais" else "insumos",
                "nome": f"Semente de {nome.lower()}" if grupo == "Sementes" else nome,
                "unidade": "R$/L" if unidade == "l" else f"R$/{unidade}",
                "praca": "Santa Catarina (média estadual)", "uf": "SC", "casas": 2,
                "fonte": "Epagri/Cepa", "url_fonte": PAGINA, "descricao": descricao,
                "destaque": False, "ordem": 170,
            },
            "pontos": [{"data": dia, "valor": valor} for dia, valor, _ in observacoes],
        })
    if not resultado:
        raise ValueError("sem preços de insumos da Epagri nas competências solicitadas")
    return resultado
