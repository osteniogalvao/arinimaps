"""Leitura incremental das planilhas de dados abertos da Epagri/Cepa."""
import datetime as dt
import io
import json
import math
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

X = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
PAGINA = "https://cepa.epagri.sc.gov.br/index.php/mercado-agricola/"
MESES = "janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro".split()
MIB = 1024 * 1024

# A unidade faz parte da identificação do produto na planilha.
DIARIO = {
    "Vaca gorda - arroba": ("vacas", "Vaca gorda", "R$/@"),
    "Leitão (+/- 22 kg) - kg": ("semoventes", "Leitão (cerca de 22 kg)", "R$/kg"),
    "Suíno vivo - produtores independentes - kg": ("semoventes", "Suíno vivo de produtor independente", "R$/kg"),
    "Suíno vivo - produtores integrados - kg": ("semoventes", "Suíno vivo de produtor integrado", "R$/kg"),
    "Arroz irrigado em casca - sc 50 kg": ("graos", "Arroz irrigado em casca", "R$/sc 50 kg"),
    "Trigo superior PH78 - sc 60 kg": ("graos", "Trigo superior PH78", "R$/sc 60 kg"),
    "Feijão-carioca - sc 60 kg": ("graos", "Feijão-carioca", "R$/sc 60 kg"),
    "Feijão-preto - sc 60 kg": ("graos", "Feijão-preto", "R$/sc 60 kg"),
    "Feijão-vermelho - sc 60 kg": ("graos", "Feijão-vermelho", "R$/sc 60 kg"),
}
SEMANAL = {
    "Bezerro para corte - até 1 ano - kg": ("semoventes", "Bezerro para corte até 1 ano", "R$/kg"),
    "Novilho para corte - de 1 a 2 anos - kg": ("semoventes", "Novilho para corte de 1 a 2 anos", "R$/kg"),
    "Leitão desmamado (6 a 10 kg) - kg": ("semoventes", "Leitão desmamado de 6 a 10 kg", "R$/kg"),
    "Aveia preta - sc 60 kg": ("graos", "Aveia preta", "R$/sc 60 kg"),
}


def slug(texto):
    ascii_texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_texto.lower()).strip("-")


def linhas(planilha, nome="xl/worksheets/sheet1.xml"):
    """Valores brutos por coluna, com memória limitada a uma linha e ao dicionário de textos."""
    strings = []
    if "xl/sharedStrings.xml" in planilha.namelist():
        if planilha.getinfo("xl/sharedStrings.xml").file_size > 4 * MIB:
            raise ValueError("dicionário XLSX excede o limite")
        with planilha.open("xl/sharedStrings.xml") as xml:
            strings = ["".join(no.itertext()) for no in ET.parse(xml).getroot()]
    if planilha.getinfo(nome).file_size > 120 * MIB:
        raise ValueError("aba XLSX excede o limite")
    with planilha.open(nome) as xml:
        tabela = None
        for evento, no in ET.iterparse(xml, events=("start", "end")):
            if no.tag == X + "sheetData" and evento == "start":
                tabela = no
            if no.tag != X + "row" or evento != "end":
                continue
            valores = {}
            for celula in no:
                if celula.tag != X + "c":
                    continue
                coluna = celula.get("r", "").rstrip("0123456789")
                valor = celula.findtext(X + "v", "")
                if celula.get("t") == "s":
                    valor = strings[int(valor)]
                elif celula.get("t") == "inlineStr":
                    valor = "".join(celula.itertext())
                valores[coluna] = valor.strip()
            if tabela is not None:
                tabela.remove(no)
            yield valores


def ler_produtor(planilha, tipo, inicio, hoje):
    produtos = DIARIO if tipo == "diario" else SEMANAL
    frequencia = "diário" if tipo == "diario" else "semanal"
    series = {}
    produtor = cabecalho = False
    for linha in linhas(planilha):
        ano = linha.get("A", "")
        if "preços ao produtor" in ano.lower():
            produtor = True
        if ano == "Ano / Mês / Dia":
            cabecalho = produtor and all(linha.get(k) == v for k, v in {
                "B": "Mês Preço", "C": "dia", "D": "Produto", "E": "nom_praca", "G": "Val. Mais Comum"
            }.items())
            if not cabecalho:
                raise ValueError("cabeçalho ou tipo de preço mudou")
        if not cabecalho or not ano.isdigit() or not inicio.year <= int(ano) <= hoje.year:
            continue
        original = linha.get("D")
        if original not in produtos:
            continue
        if linha.get("B") not in MESES:
            raise ValueError("mês não reconhecido")
        data = dt.date(int(ano), MESES.index(linha["B"]) + 1, int(linha["C"]))
        praca, bruto = linha.get("E", ""), linha.get("G", "")
        if not inicio <= data <= hoje or not praca or bruto in ("", "-", "..."):
            continue
        valor = float(bruto)
        if not math.isfinite(valor) or valor <= 0:
            continue
        produto, nome, unidade = produtos[original]
        ident = "epagri-sc-" + slug(original) + "-" + slug(praca)
        if ident not in series:
            serie = {
                "slug": ident, "produto": produto, "nome": nome, "unidade": unidade, "praca": praca, "uf": "SC",
                "descricao": f"Preço mais comum ao produtor no levantamento {frequencia} da Epagri/Cepa.",
                "casas": 2, "ordem": 160, "fonte": "Epagri/Cepa", "url_fonte": PAGINA, "destaque": False,
            }
            series[ident] = (serie, {})
        observacoes = series[ident][1]
        dia = data.isoformat()
        valor = round(valor, 4)
        if dia in observacoes and observacoes[dia] != valor:
            raise ValueError(f"mais de um preço para {ident} em {dia}")
        observacoes[dia] = valor
    # Não cria séries interrompidas como novos indicadores regionais.
    limite = (hoje - dt.timedelta(days=40)).isoformat()
    resultado = [
        {"serie": serie, "pontos": [{"data": dia, "valor": valor} for dia, valor in sorted(observacoes.items())]}
        for serie, observacoes in series.values() if max(observacoes) >= limite
    ]
    if not resultado:
        raise ValueError("sem observações recentes com a estrutura esperada")
    return resultado


if __name__ == "__main__":
    tipo, data_inicial, data_final = sys.argv[1:]
    inicio, hoje = dt.date.fromisoformat(data_inicial), dt.date.fromisoformat(data_final)
    conteudo = sys.stdin.buffer.read(20 * MIB + 1)
    if len(conteudo) > 20 * MIB:
        raise ValueError("arquivo XLSX excede 20 MiB")
    with zipfile.ZipFile(io.BytesIO(conteudo)) as planilha:
        if tipo == "insumos":
            from epagri_insumos import ler
            resultado = ler(planilha, inicio, hoje)
        elif tipo in ("diario", "semanal"):
            resultado = ler_produtor(planilha, tipo, inicio, hoje)
        else:
            raise ValueError("arquivo Epagri desconhecido")
    print(json.dumps(resultado, separators=(",", ":"), allow_nan=False))
