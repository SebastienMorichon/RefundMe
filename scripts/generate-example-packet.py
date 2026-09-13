from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "exemple-dossier-lydoc.pdf"
FONT_DIR = ROOT / "apps" / "api" / "assets" / "fonts"

GREEN = colors.HexColor("#087A55")
DARK = colors.HexColor("#17211D")
MUTED = colors.HexColor("#5D6881")
PALE = colors.HexColor("#E8F7F0")
CREAM = colors.HexColor("#FBFAF5")
YELLOW = colors.HexColor("#F4B942")
CORAL = colors.HexColor("#E9654B")
LINE = colors.HexColor("#DCE5E0")


def register_fonts():
    pdfmetrics.registerFont(TTFont("Poppins", FONT_DIR / "Poppins-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("Poppins-SemiBold", FONT_DIR / "Poppins-SemiBold.ttf"))


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Poppins-SemiBold",
            fontSize=22,
            leading=28,
            textColor=DARK,
            alignment=TA_LEFT,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Poppins-SemiBold",
            fontSize=13,
            leading=18,
            textColor=DARK,
            spaceBefore=8,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Poppins",
            fontSize=9.5,
            leading=15,
            textColor=DARK,
            spaceAfter=8,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Poppins",
            fontSize=7.8,
            leading=12,
            textColor=MUTED,
        ),
        "label": ParagraphStyle(
            "Label",
            parent=base["BodyText"],
            fontName="Poppins-SemiBold",
            fontSize=7.5,
            leading=11,
            textColor=GREEN,
            uppercase=True,
        ),
        "center": ParagraphStyle(
            "Center",
            parent=base["BodyText"],
            fontName="Poppins-SemiBold",
            fontSize=10,
            leading=15,
            textColor=DARK,
            alignment=TA_CENTER,
        ),
    }


def draw_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(DARK)
    canvas.rect(0, height - 18 * mm, width, 18 * mm, stroke=0, fill=1)
    canvas.setFont("Poppins-SemiBold", 12)
    canvas.setFillColor(colors.white)
    canvas.drawString(18 * mm, height - 11.5 * mm, "LYDOC")
    canvas.setFont("Poppins", 7.5)
    canvas.setFillColor(colors.HexColor("#C2CEDE"))
    canvas.drawRightString(width - 18 * mm, height - 11.5 * mm, "DOSSIER DE DÉMONSTRATION")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 15 * mm, width - 18 * mm, 15 * mm)
    canvas.setFont("Poppins", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 9 * mm, "Exemple fictif - aucune demande réelle - aucun remboursement garanti")
    canvas.drawRightString(width - 18 * mm, 9 * mm, f"Page {doc.page}")
    canvas.setFont("Poppins-SemiBold", 40)
    canvas.setFillColor(colors.Color(0.03, 0.48, 0.33, alpha=0.07))
    canvas.translate(width / 2, height / 2)
    canvas.rotate(35)
    canvas.drawCentredString(0, 0, "EXEMPLE FICTIF")
    canvas.restoreState()


def info_box(st, title, text, background=PALE):
    table = Table(
        [[Paragraph(title, st["h2"]), Paragraph(text, st["body"])]],
        colWidths=[43 * mm, 111 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), background),
                ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def build_story():
    st = styles()
    story = []

    story.extend(
        [
            Paragraph("Exemple de dossier préparé avec Lydoc", st["title"]),
            Paragraph(
                "Ce document montre la structure d'un dossier fictif. Les noms, montants, dates, numéro et adresse sont inventés. Le contenu réel dépend toujours du règlement sélectionné et des informations confirmées par l'utilisateur.",
                st["body"],
            ),
            Spacer(1, 4 * mm),
            info_box(
                st,
                "Dossier fictif",
                "Jeu Exemple TV - Session du 10 septembre 2026<br/>3 SMS+ déclarés - 2,97 EUR estimés<br/>Règlement fictif vérifié pour cette démonstration",
            ),
            Spacer(1, 8 * mm),
            Paragraph("Lettre de demande", st["h2"]),
            Paragraph("Camille Exemple<br/>12 rue de la Demonstration<br/>75000 Paris", st["body"]),
            Paragraph("Service consommateurs - Jeu Exemple TV<br/>Adresse fictive<br/>75000 Paris", st["body"]),
            Spacer(1, 3 * mm),
            Paragraph("Paris, le 13 septembre 2026", st["body"]),
            Paragraph(
                "<b>Objet : demande de remboursement des frais de participation par SMS+</b>",
                st["body"],
            ),
            Paragraph("Madame, Monsieur,", st["body"]),
            Paragraph(
                "Conformément aux modalités prévues par le règlement fictif du Jeu Exemple TV, je vous adresse une demande concernant les frais de participation facturés sur la ligne 06 XX XX XX XX pour la session du 10 septembre 2026.",
                st["body"],
            ),
            Paragraph(
                "Les trois participations déclarées représentent un montant total de 2,97 EUR. Vous trouverez en pièces jointes les justificatifs indiqués dans le règlement de démonstration.",
                st["body"],
            ),
            Paragraph(
                "Je vous remercie d'examiner cette demande selon les conditions applicables.",
                st["body"],
            ),
            Spacer(1, 4 * mm),
            Paragraph("Camille Exemple", st["body"]),
            Spacer(1, 4 * mm),
            info_box(
                st,
                "A retenir",
                "Lydoc aide à préparer le dossier. L'organisateur contrôle l'éligibilité, accepte ou refuse la demande et décide du remboursement.",
                CREAM,
            ),
            PageBreak(),
        ]
    )

    rows = [
        ["Contrôle", "Valeur de démonstration", "État"],
        ["Nom du jeu", "Jeu Exemple TV", "OK"],
        ["Date de participation", "10 septembre 2026", "OK"],
        ["Nombre de SMS+", "3", "OK"],
        ["Montant total déclaré", "2,97 EUR", "OK"],
        ["Facture détaillée", "Facture fictive - septembre 2026", "Jointe"],
        ["Identité", "Demandée par le règlement fictif", "Jointe"],
        ["RIB", "Demandé par le règlement fictif", "Joint"],
        ["Adresse d'envoi", "Vérifiée dans le règlement fictif", "OK"],
        ["Date limite", "30 septembre 2026", "Dans le délai"],
    ]
    checklist = Table(rows, colWidths=[45 * mm, 78 * mm, 31 * mm], repeatRows=1)
    checklist.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DARK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Poppins-SemiBold"),
                ("FONTNAME", (0, 1), (-1, -1), "Poppins"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CREAM]),
                ("TEXTCOLOR", (2, 1), (2, -1), GREEN),
                ("FONTNAME", (2, 1), (2, -1), "Poppins-SemiBold"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.extend(
        [
            Paragraph("Checklist du dossier", st["title"]),
            Paragraph(
                "Cette page illustre les contrôles effectués avant le téléchargement. Une checklist réelle est adaptée au règlement sélectionné.",
                st["body"],
            ),
            Spacer(1, 5 * mm),
            checklist,
            Spacer(1, 10 * mm),
            info_box(
                st,
                "Relecture utilisateur",
                "Avant l'envoi, l'utilisateur vérifie les coordonnées, les montants, les pièces, l'adresse et le délai. Lydoc ne transmet actuellement aucun courrier à sa place.",
            ),
            Spacer(1, 8 * mm),
            Paragraph("Pièces de démonstration", st["h2"]),
            Paragraph(
                "1. Facture mobile fictive<br/>2. Pièce d'identité fictive masquée<br/>3. RIB fictif masqué<br/>4. Copie de la lettre de demande",
                st["body"],
            ),
            PageBreak(),
        ]
    )

    invoice_rows = [
        ["Date", "Service", "Numéro", "Quantité", "Montant"],
        ["10/09/2026 20:41", "SMS+ Jeu Exemple", "72XXX", "1", "0,99 EUR"],
        ["10/09/2026 20:43", "SMS+ Jeu Exemple", "72XXX", "1", "0,99 EUR"],
        ["10/09/2026 20:45", "SMS+ Jeu Exemple", "72XXX", "1", "0,99 EUR"],
        ["", "", "Total", "3", "2,97 EUR"],
    ]
    invoice = Table(invoice_rows, colWidths=[37 * mm, 51 * mm, 26 * mm, 20 * mm, 27 * mm], repeatRows=1)
    invoice.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2F0")),
                ("FONTNAME", (0, 0), (-1, 0), "Poppins-SemiBold"),
                ("FONTNAME", (0, 1), (-1, -1), "Poppins"),
                ("FONTNAME", (2, -1), (-1, -1), "Poppins-SemiBold"),
                ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, -1), (-1, -1), PALE),
                ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend(
        [
            Paragraph("Extrait de facture fictive", st["title"]),
            Paragraph(
                "Cet extrait a été créé uniquement pour la démonstration. Il ne provient d'aucun opérateur et ne contient aucune donnée réelle.",
                st["body"],
            ),
            Spacer(1, 6 * mm),
            KeepTogether(
                [
                    info_box(
                        st,
                        "Titulaire fictif",
                        "Camille Exemple - Ligne 06 XX XX XX XX<br/>Periode de facturation : septembre 2026",
                        CREAM,
                    ),
                    Spacer(1, 6 * mm),
                    invoice,
                ]
            ),
            Spacer(1, 10 * mm),
            Paragraph("Ce que l'utilisateur confirme dans Lydoc", st["h2"]),
            Paragraph(
                "Le nombre de SMS, le montant total et le jeu concerné sont confirmés par l'utilisateur. Lydoc les rapproche ensuite du règlement sélectionné pour préparer le dossier.",
                st["body"],
            ),
            Spacer(1, 6 * mm),
            info_box(
                st,
                "Protection des données",
                "N'utilisez jamais une facture réelle dans une publication. Pour une démonstration, remplacez toutes les données par des informations fictives ou obtenez un consentement écrit et masquez les identifiants.",
                colors.HexColor("#FFF0EC"),
            ),
        ]
    )
    return story


def main():
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=27 * mm,
        bottomMargin=21 * mm,
        title="Exemple fictif de dossier Lydoc",
        author="Lydoc",
        subject="Démonstration du dossier de remboursement préparé par Lydoc",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="content")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=draw_page)])
    doc.build(build_story())
    print(OUTPUT)


if __name__ == "__main__":
    main()
