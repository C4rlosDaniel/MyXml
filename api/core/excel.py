"""Geracao da planilha Excel com as notas do periodo."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

LARANJA = "F97316"
LARANJA_CLARO = "FFF7ED"
CINZA = "475569"
CINZA_CLARO = "F1F5F9"
BORDA = "E2E8F0"
BRANCO = "FFFFFF"
AZUL = "2563EB"

FONTE = "Segoe UI"

SITUACOES = {
    "100": "100 - Autorizada",
    "101": "101 - Cancelada",
    "110": "110 - Denegada",
    "301": "301 - Uso denegado",
    "302": "302 - Uso denegado",
}

_BORDA_FINA = Border(
    left=Side(style="thin", color=BORDA),
    right=Side(style="thin", color=BORDA),
    top=Side(style="thin", color=BORDA),
    bottom=Side(style="thin", color=BORDA),
)


def nome_arquivo(inicio: datetime, fim: datetime) -> str:
    if (inicio.year, inicio.month) == (fim.year, fim.month):
        return f"NFCe-{inicio:%Y-%m}.xlsx"
    return f"NFCe-{inicio:%Y-%m-%d}_a_{fim:%Y-%m-%d}.xlsx"


def _data(valor) -> datetime | None:
    if isinstance(valor, datetime):
        return valor.replace(tzinfo=None)
    if not valor:
        return None
    try:
        return datetime.fromisoformat(str(valor)).replace(tzinfo=None)
    except ValueError:
        return None


def _numero(valor) -> float:
    try:
        return round(float(str(valor).replace(",", ".")), 2)
    except (TypeError, ValueError):
        return 0.0


def _situacao(codigo) -> str:
    codigo = str(codigo or "").strip()
    return SITUACOES.get(codigo, codigo or "-")


def _estilo_cabecalho(celula) -> None:
    celula.fill = PatternFill("solid", start_color=LARANJA)
    celula.font = Font(name=FONTE, size=11, bold=True, color=BRANCO)
    celula.alignment = Alignment(horizontal="center", vertical="center")
    celula.border = _BORDA_FINA


def exportar(
    destino: str | Path,
    *,
    empresa_nome: str,
    cnpj: str,
    inicio: datetime,
    fim: datetime,
    notas: list[dict],
    usuario: str = "",
    maquina: str = "",
    pasta_xml: str | Path | None = None,
) -> dict:
    """Gera o .xlsx com resumo e lista de notas; devolve estatisticas."""
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)

    notas = sorted(
        notas,
        key=lambda nota: (_data(nota.get("emitida_em")) or datetime.min),
    )
    valor_total = round(sum(_numero(nota.get("valor")) for nota in notas), 2)
    autorizadas = sum(1 for nota in notas if str(nota.get("situacao")) == "100")

    wb = Workbook()
    wb.properties.title = "NFC-e"
    wb.properties.creator = "Baixar NFC-e"

    # ---------------------------------------------------------- resumo
    resumo = wb.active
    resumo.title = "Resumo"
    resumo.sheet_view.showGridLines = False
    resumo.column_dimensions["A"].width = 26
    resumo.column_dimensions["B"].width = 64
    resumo.column_dimensions["C"].width = 26

    resumo.merge_cells("A1:C1")
    titulo = resumo["A1"]
    titulo.value = "Resumo das NFC-e"
    titulo.font = Font(name=FONTE, size=16, bold=True, color=BRANCO)
    titulo.fill = PatternFill("solid", start_color=LARANJA)
    titulo.alignment = Alignment(horizontal="left", vertical="center")
    resumo.row_dimensions[1].height = 32

    linhas = [
        ("Empresa", empresa_nome),
        ("CNPJ", cnpj),
        ("Período", f"{inicio:%d/%m/%Y %H:%M} a {fim:%d/%m/%Y %H:%M}"),
        ("Quantidade de notas", len(notas)),
        ("Notas autorizadas", autorizadas),
        ("Valor total", valor_total),
        ("Gerado em", datetime.now().strftime("%d/%m/%Y %H:%M")),
        ("Gerado por", f"{usuario} ({maquina})".strip(" ()") or "-"),
    ]
    if pasta_xml:
        linhas.append(("Pasta dos XMLs", str(pasta_xml)))

    for indice, (rotulo, valor) in enumerate(linhas, start=3):
        celula_rotulo = resumo.cell(row=indice, column=1, value=rotulo)
        celula_rotulo.font = Font(name=FONTE, size=11, bold=True, color=CINZA)
        celula_rotulo.border = _BORDA_FINA
        celula_valor = resumo.cell(row=indice, column=2, value=valor)
        celula_valor.font = Font(name=FONTE, size=11)
        celula_valor.border = _BORDA_FINA
        celula_valor.alignment = Alignment(vertical="center", wrap_text=True)

        if rotulo == "Valor total":
            celula_valor.number_format = 'R$ #,##0.00'
            celula_valor.font = Font(name=FONTE, size=12, bold=True, color=LARANJA)

    aviso = resumo.cell(
        row=len(linhas) + 5,
        column=1,
        value=(
            "As chaves das notas estão na aba \"Notas\" e os XMLs completos "
            "ficam na pasta de XMLs da empresa."
        ),
    )
    aviso.font = Font(name=FONTE, size=9, italic=True, color=CINZA)

    # ---------------------------------------------------------- notas
    aba = wb.create_sheet("Notas")
    aba.sheet_view.showGridLines = False
    cabecalhos = (
        ("Chave", 46),
        ("Data e hora", 19),
        ("Número", 10),
        ("Série", 8),
        ("Modelo", 8),
        ("Situação", 20),
        ("Valor (R$)", 14),
    )
    for coluna, (texto, largura) in enumerate(cabecalhos, start=1):
        aba.column_dimensions[get_column_letter(coluna)].width = largura
        celula = aba.cell(row=1, column=coluna, value=texto)
        _estilo_cabecalho(celula)
    aba.row_dimensions[1].height = 24

    if not notas:
        aba.merge_cells("A2:G2")
        vazio = aba["A2"]
        vazio.value = "Nenhuma NFC-e encontrada neste período."
        vazio.font = Font(name=FONTE, size=11, italic=True, color=CINZA)
        vazio.alignment = Alignment(horizontal="center", vertical="center")
    else:
        for linha, nota in enumerate(notas, start=2):
            valores = (
                str(nota.get("chave", "")),
                _data(nota.get("emitida_em")),
                str(nota.get("numero", "")),
                str(nota.get("serie", "")),
                str(nota.get("modelo", "")),
                _situacao(nota.get("situacao")),
                _numero(nota.get("valor")),
            )
            for coluna, valor in enumerate(valores, start=1):
                celula = aba.cell(row=linha, column=coluna, value=valor)
                celula.font = Font(name=FONTE, size=10)
                celula.border = _BORDA_FINA
                celula.alignment = Alignment(vertical="center")
                if linha % 2 == 0:
                    celula.fill = PatternFill("solid", start_color="F8FAFC")

            aba.cell(row=linha, column=1).number_format = "@"
            data = aba.cell(row=linha, column=2)
            if isinstance(data.value, datetime):
                data.number_format = "dd/mm/yyyy hh:mm"
            aba.cell(row=linha, column=7).number_format = 'R$ #,##0.00'
            if str(nota.get("situacao")) != "100":
                aba.cell(row=linha, column=6).font = Font(
                    name=FONTE, size=10, color="DC2626", bold=True
                )

        ultima = len(notas) + 1
        aba.auto_filter.ref = f"A1:G{ultima}"
        total_linha = ultima + 1
        rotulo_total = aba.cell(row=total_linha, column=1, value="TOTAL")
        rotulo_total.font = Font(name=FONTE, size=11, bold=True)
        rotulo_total.fill = PatternFill("solid", start_color=LARANJA_CLARO)
        celula_total = aba.cell(row=total_linha, column=7, value=valor_total)
        celula_total.font = Font(name=FONTE, size=11, bold=True, color=LARANJA)
        celula_total.number_format = 'R$ #,##0.00'
        celula_total.fill = PatternFill("solid", start_color=LARANJA_CLARO)
        for coluna in range(1, 8):
            aba.cell(row=total_linha, column=coluna).border = _BORDA_FINA

    aba.freeze_panes = "A2"
    aba.sheet_properties.pageSetUpPr.fitToPage = True
    aba.page_setup.orientation = "landscape"
    aba.page_setup.fitToWidth = 1

    wb.save(destino)
    return {
        "caminho": str(destino),
        "notas": len(notas),
        "autorizadas": autorizadas,
        "valor_total": valor_total,
    }
