# -*- coding: utf-8 -*-
"""PDFs de entrega Intelfon con formato visual IAKimi (logo, colores, tipografía)."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    HRFlowable,
    Flowable,
)

OUT = Path.home() / "Downloads"
LOGO = Path.home() / "Downloads" / "_iakimi_template_extract" / "unzipped" / "word" / "media" / "image1.jpg"

# Brand IAKimi (extraído del Word)
ORANGE = colors.HexColor("#F34B26")
ORANGE_SOFT = colors.HexColor("#FDE8E3")
GRAY_BG = colors.HexColor("#F5F5F5")
SLATE = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#555555")
BORDER = colors.HexColor("#E5E5E5")
WHITE = colors.white


class OrangeBar(Flowable):
    def __init__(self, width=16.5 * cm, height=3):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def draw(self):
        self.canv.setFillColor(ORANGE)
        self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)


def S():
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            textColor=SLATE,
            alignment=TA_CENTER,
            leading=26,
            spaceAfter=6,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            leading=15,
            spaceAfter=4,
        ),
        "meta_label": ParagraphStyle(
            "meta_label",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            textColor=ORANGE,
            alignment=TA_CENTER,
        ),
        "meta_val": ParagraphStyle(
            "meta_val",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=SLATE,
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=ORANGE,
            spaceBefore=14,
            spaceAfter=8,
            leading=17,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11,
            textColor=SLATE,
            spaceBefore=10,
            spaceAfter=5,
            leading=14,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10,
            textColor=MUTED,
            spaceBefore=8,
            spaceAfter=4,
            leading=13,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            textColor=SLATE,
            alignment=TA_JUSTIFY,
            leading=13,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.2,
            textColor=SLATE,
            leading=12.5,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            leading=11,
            spaceAfter=4,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=SLATE,
            leading=10.5,
        ),
        "cell_h": ParagraphStyle(
            "cell_h",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            textColor=WHITE,
            leading=10.5,
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=SLATE,
            leading=12.5,
        ),
        "mono": ParagraphStyle(
            "mono",
            parent=base["Normal"],
            fontName="Courier",
            fontSize=7.5,
            textColor=SLATE,
            leading=10,
        ),
        "step": ParagraphStyle(
            "step",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            textColor=ORANGE,
            leading=12,
            spaceBefore=6,
            spaceAfter=2,
        ),
    }


def header_footer(canvas, doc, doc_title):
    canvas.saveState()
    # top orange line
    canvas.setStrokeColor(ORANGE)
    canvas.setLineWidth(2.2)
    w, h = letter
    canvas.line(1.6 * cm, h - 1.15 * cm, w - 1.6 * cm, h - 1.15 * cm)
    # logo small
    if LOGO.exists():
        try:
            canvas.drawImage(
                str(LOGO),
                1.6 * cm,
                h - 1.05 * cm,
                width=2.6 * cm,
                height=0.72 * cm,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            pass
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(w - 1.6 * cm, h - 0.85 * cm, doc_title[:70])
    # footer
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.6)
    canvas.line(1.6 * cm, 1.35 * cm, w - 1.6 * cm, 1.35 * cm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(1.6 * cm, 0.85 * cm, "IAKimi · Uso interno · Intelfon / RED Gestión de Visitas")
    canvas.drawRightString(w - 1.6 * cm, 0.85 * cm, f"Página {doc.page}")
    canvas.restoreState()


def make_doc(path, title):
    return SimpleDocTemplate(
        str(path),
        pagesize=letter,
        leftMargin=1.6 * cm,
        rightMargin=1.6 * cm,
        topMargin=1.8 * cm,
        bottomMargin=2.0 * cm,
        title=title,
        author="IAKimi",
    )


def cover(story, s, title, subtitle, meta_rows):
    story.append(Spacer(1, 0.6 * cm))
    if LOGO.exists():
        img = Image(str(LOGO), width=5.8 * cm, height=1.55 * cm)
        img.hAlign = "CENTER"
        story.append(img)
    story.append(Spacer(1, 0.55 * cm))
    story.append(OrangeBar())
    story.append(Spacer(1, 0.45 * cm))
    story.append(Paragraph(title.upper(), s["cover_title"]))
    story.append(Paragraph(subtitle, s["cover_sub"]))
    story.append(Spacer(1, 0.35 * cm))
    # meta table
    cells = []
    for label, val in meta_rows:
        cells.append(
            [
                Paragraph(label, s["meta_label"]),
                Paragraph(val, s["meta_val"]),
            ]
        )
    meta = Table(cells, colWidths=[4 * cm, 5 * cm])
    meta.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ORANGE_SOFT),
                ("BOX", (0, 0), (-1, -1), 1, ORANGE),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, ORANGE),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    meta.hAlign = "CENTER"
    story.append(meta)
    story.append(Spacer(1, 0.5 * cm))
    story.append(OrangeBar())
    story.append(Spacer(1, 0.4 * cm))


def callout(text, title="IMPORTANTE"):
    s = S()
    inner = Table(
        [
            [Paragraph(f"<b>{title}</b>", ParagraphStyle("ct", parent=s["callout"], textColor=ORANGE, fontName="Helvetica-Bold"))],
            [Paragraph(text, s["callout"])],
        ],
        colWidths=[16.8 * cm],
    )
    inner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ORANGE_SOFT),
                ("BOX", (0, 0), (-1, -1), 1.2, ORANGE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return inner


def tbl(headers, rows, widths=None):
    s = S()
    data = [[Paragraph(h, s["cell_h"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), s["cell"]) for c in row])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ORANGE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [GRAY_BG, WHITE]),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return t


def bullets(items):
    s = S()
    return ListFlowable(
        [ListItem(Paragraph(i, s["bullet"]), leftIndent=10, bulletColor=ORANGE) for i in items],
        bulletType="bullet",
        start="•",
        leftIndent=12,
        bulletFontSize=9,
    )


def flow_diagram():
    s = S()
    lines = [
        "<b>FLUJO COMPLETO DE LA PLATAFORMA (adaptación PELSA → Intelfon / RED)</b>",
        "",
        "1) LOGIN  →  correo o alias + contraseña",
        "         →  Admin va a /admin   |   Jefe / Vendedor van a Inicio (/)",
        "",
        "2) (Opcional) PROGRAMAR CITA",
        "         →  Citas → Cliente o Prospección → fecha (hoy o futura) → Guardar",
        "         →  Jefe puede asignar la cita a un vendedor de su equipo",
        "",
        "3) REGISTRAR SALIDA  (Inicio → Registro de salida)",
        "         →  Elegir destino: CLIENTE (cartera) o PROSPECCIÓN",
        "         →  Completar formulario (objetivo, tipo de salida, etc.)",
        "         →  Al pulsar ENVIAR: la app CAPTURA GPS DE ORIGEN",
        "            (posición actual del dispositivo = punto de partida)",
        "         →  Queda una SALIDA EN ESTADO PENDIENTE",
        "",
        "4) EN EL LUGAR DEL CLIENTE / PROSPECTO",
        "         →  Inicio → Visitas pendientes → abrir la salida",
        "         →  Completar reporte (comentarios, resultado, etc.)",
        "         →  Adjuntar FOTO (obligatoria)",
        "         →  Al pulsar ENVIAR: la app CAPTURA GPS DE DESTINO",
        "            (posición actual = lugar de la visita)",
        "         →  CALCULA LA DISTANCIA (km) entre GPS origen y GPS destino",
        "         →  La salida pasa a REALIZADA / VISITADA",
        "",
        "5) DASHBOARD",
        "         →  Vendedor: métricas personales (salidas, pendientes, km, fotos, %)",
        "         →  Jefe: métricas de su equipo",
        "         →  Admin: métricas globales por país / ejecutivo",
        "",
        "6) COMBUSTIBLE / REINTEGRO",
        "         →  El módulo EXISTE (diseñado en el alcance tipo PELSA)",
        "         →  Está INACTIVO para Intelfon (modelo Legacy / no lo usan)",
        "         →  No aparece en el menú mientras esté apagado",
    ]
    body = "<br/>".join(lines)
    box = Table([[Paragraph(body, s["mono"])]], colWidths=[16.8 * cm])
    box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), GRAY_BG),
                ("BOX", (0, 0), (-1, -1), 1, ORANGE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return box


# ---------------------------------------------------------------------------
# DOC 1
# ---------------------------------------------------------------------------
def build_alcance():
    s = S()
    path = OUT / "Alcance acordado con IAKimi.pdf"
    title = "Alcance acordado con IAKimi"
    story = []
    cover(
        story,
        s,
        "Alcance acordado con IAKimi",
        "Intelfon / RED — Gestión de Visitas<br/>Adaptación del flujo tipo PELSA a plataforma web",
        [
            ("Versión", "1.0"),
            ("Fecha", "Noviembre 2026"),
            ("Cliente", "Intelfon / RED (SV · GT)"),
            ("Clasificación", "Uso interno / entrega"),
        ],
    )

    story.append(
        callout(
            "Todo lo descrito en este documento es lo que se contempló bajo el <b>alcance acordado</b> "
            "de la adaptación del flujo tipo PELSA para Intelfon / RED. Cualquier pedido posterior a la "
            "entrega se lista en el documento <b>Fuera de alcance a cotizar</b> y se cotiza por separado. "
            "No se asume en garantía lo que no está aquí."
        )
    )

    story.append(Paragraph("1. Introducción y propósito", s["h1"]))
    story.append(
        Paragraph(
            "IAKimi adaptó para Intelfon / RED una solución de <b>gestión de visitas de campo</b> "
            "basada en el flujo operativo que ya existía para otra compañía (PELSA), originalmente "
            "orquestado con Google Sheets + Make (programar visita, registrar salida, reportar visita, "
            "calcular kilometraje / combustible).",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "El entregable acordado es una <b>aplicación web publicada en línea</b> (no el Sheets de PELSA), "
            "con login por roles, cartera por ejecutivo, captura GPS en salida y en cierre de visita, "
            "cálculo de distancia, foto obligatoria al cerrar, dashboard operativo y administración "
            "para El Salvador y Guatemala.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Fuente de verdad del alcance:</b> el flujo Make / Google de PELSA compartido al inicio "
            "del proyecto, adaptado a la herramienta publicada con los matices de RED/Intelfon.",
            s["body"],
        )
    )

    story.append(Paragraph("2. Objetivo de la plataforma (alcance actual)", s["h1"]))
    story.append(
        Paragraph(
            "El objetivo con el que está contemplada la plataforma <b>hoy</b> para Intelfon es:",
            s["body"],
        )
    )
    story.append(
        bullets(
            [
                "<b>Disciplina operativa de visitas:</b> que el ejecutivo registre cuándo sale y a quién visita.",
                "<b>Trazabilidad GPS:</b> capturar posición al registrar la salida (origen) y al cerrar la visita en el lugar (destino), y calcular la distancia recorrida.",
                "<b>Evidencia de visita:</b> foto obligatoria al retroalimentar en sitio.",
                "<b>Visibilidad para jefatura:</b> dashboard con salidas, pendientes, km, fotos y porcentaje de cumplimiento (alcance del dashboard entregado).",
                "<b>Cartera por ejecutivo:</b> seleccionar cliente de cartera o registrar prospección.",
                "<b>Programación:</b> poder agendar visitas para hoy o días futuros (y que el jefe pueda agendar al equipo).",
                "<b>Combustible / viáticos:</b> el módulo está <b>diseñado e incluido</b> en el alcance (como en PELSA), pero <b>queda inactivo</b> porque Intelfon no ocupa ese modelo de negocio.",
            ]
        )
    )
    story.append(
        callout(
            "La plataforma <b>no</b> está pensada, en este alcance, como integración SAN, ni como "
            "dashboard ejecutivo transversal (forecast + cartera + otros sistemas), ni como motor de "
            "alertas automáticas a jefatura. Eso queda fuera y se cotiza aparte.",
            title="LÍMITE DEL OBJETIVO ACTUAL",
        )
    )

    story.append(Paragraph("3. Qué incluye el alcance acordado", s["h1"]))
    story.append(
        tbl(
            ["Bloque", "Detalle", "Estado"],
            [
                ["App web", "Login, roles, uso en celular (recomendado) y PC", "Incluido"],
                ["Registro de salida", "Formulario + captura GPS de origen al enviar", "Incluido"],
                ["Programación de citas", "Hoy o días futuros; jefe puede asignar al equipo", "Incluido"],
                ["Retroalimentación de visita", "Cerrar salida pendiente en el lugar", "Incluido"],
                ["GPS en visita", "Nueva captura GPS de destino al enviar el reporte", "Incluido"],
                ["Distancia (km)", "Cálculo entre GPS origen y GPS destino", "Incluido"],
                ["Foto", "Obligatoria al cerrar la visita", "Incluido"],
                ["Cliente / prospección", "Cartera cargada o destino de prospección", "Incluido"],
                ["Cartera", "Por ejecutivo; administración / importación", "Incluido"],
                ["Dashboard entregado", "Salidas, pendientes, km, foto, % cumplimiento, filtros", "Incluido"],
                ["Roles", "Vendedor, jefe de ventas, administrador", "Incluido"],
                ["Admin por país", "admin@red.com.sv y admin@red.com.gt", "Incluido"],
                ["Combustible / reintegro", "Diseñado en alcance; INACTIVO para Intelfon", "Incluido / off"],
                ["API de lectura", "/api/export/* para consulta (capacidad técnica)", "Incluido"],
                ["Manual de usuario", "Documento de entrega obligatorio", "Incluido"],
            ],
            widths=[3.8 * cm, 9.2 * cm, 3.8 * cm],
        )
    )

    story.append(Paragraph("4. Combustible y viáticos (diseñado, inactivo)", s["h1"]))
    story.append(
        Paragraph(
            "En el flujo PELSA el kilometraje alimentaba el modelo de combustible / reintegro. "
            "En la adaptación para Intelfon ese módulo <b>sí se diseñó e implementó</b> dentro del "
            "alcance (pantalla de reintegro, flags por usuario, catálogos de pago/transporte). "
            "Sin embargo, <b>se dejó inactivado</b> porque Intelfon <b>no utiliza ese modelo de negocio</b>. "
            "Los usuarios operan con configuración Legacy / combustible apagado: no ven Reintegro en el menú "
            "y el reporte de visita no exige datos de combustible. Activarlo en el futuro es "
            "configuración administrativa, no un nuevo desarrollo de alcance base.",
            s["body"],
        )
    )

    story.append(Paragraph("5. GPS y distancia (regla de negocio del alcance)", s["h1"]))
    story.append(
        bullets(
            [
                "<b>Al registrar la salida:</b> al pulsar Enviar, la plataforma captura la posición GPS actual (origen). Teóricamente debe ser la oficina o el punto de partida.",
                "<b>Al registrar / cerrar la visita con el cliente en el lugar:</b> al pulsar Enviar del reporte, se vuelve a capturar el GPS (destino).",
                "<b>Distancia:</b> se calcula entre ambos puntos y queda asociada a la visita (km).",
                "<b>Buena práctica:</b> retroalimentar en el sitio del cliente. Si se cierra en la oficina, el km saldrá ~0 o muy bajo.",
                "<b>Foto:</b> obligatoria en el cierre; es evidencia de la visita.",
            ]
        )
    )

    story.append(Paragraph("6. Flujo completo contemplado", s["h1"]))
    story.append(flow_diagram())

    story.append(Paragraph("7. Qué no incluye este alcance", s["h1"]))
    story.append(
        bullets(
            [
                "Integración SAN (prospecto → cliente en ERP).",
                "Alertas automáticas a jefatura por no retroalimentar.",
                "Dashboard robusto transversal fuera de la app (forecast, cartera unificada, etc.).",
                "Geocerca / bloqueo duro si se retroalimenta en la oficina.",
                "Ampliación formal a SAC / mensajeros más allá del piloto de ventas.",
                "Migración a servidores del cliente y modelo de cobro de hosting.",
                "Todo lo listado en <b>Fuera de alcance a cotizar</b>.",
            ]
        )
    )

    story.append(Paragraph("8. Criterio de cierre y cambios", s["h1"]))
    story.append(
        bullets(
            [
                "Congelar y validar únicamente lo de las secciones 2–6.",
                "Pedidos de la reunión de seguimiento → documento de fuera de alcance → cotización.",
                "Si el cliente pide algo no listado aquí: cotizar antes de desarrollar.",
            ]
        )
    )

    story.append(Spacer(1, 10))
    story.append(Paragraph("Documento de alcance acordado · IAKimi · Noviembre 2026", s["small"]))

    doc = make_doc(path, title)

    def _hf(c, d):
        header_footer(c, d, title)

    doc.build(story, onFirstPage=_hf, onLaterPages=_hf)
    return path


# ---------------------------------------------------------------------------
# DOC 2 — Manual
# ---------------------------------------------------------------------------
def build_manual():
    s = S()
    path = OUT / "Manual de usuario.pdf"
    title = "Manual de usuario"
    story = []
    cover(
        story,
        s,
        "Manual de usuario",
        "Intelfon / RED — Gestión de Visitas<br/>Cómo se usa la plataforma · Roles · Credenciales · Flujos · GPS",
        [
            ("Versión", "1.0"),
            ("Fecha", "Noviembre 2026"),
            ("Cliente", "Intelfon / RED (SV · GT)"),
            ("Clasificación", "Documentación de usuario"),
        ],
    )

    story.append(
        callout(
            "Este manual explica <b>cómo se usa</b> la plataforma entregada bajo el alcance acordado. "
            "Si algo no aparece aquí, no forma parte del alcance actual o está inactivo (p. ej. combustible). "
            "Lea también el documento <b>Alcance acordado con IAKimi</b>."
        )
    )

    story.append(Paragraph("1. Objetivo de la plataforma (para el usuario)", s["h1"]))
    story.append(
        Paragraph(
            "La plataforma sirve para que el equipo de ventas de Intelfon / RED <b>registre salidas, "
            "visite clientes o prospectos, deje evidencia (foto) y permita a jefatura ver cumplimiento</b>. "
            "No reemplaza SAN ni Meta Ads. Su foco actual es <b>disciplina de visitas + GPS + dashboard operativo</b>.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "El módulo de <b>combustible / viáticos está diseñado</b> (heredado del modelo PELSA) pero "
            "<b>permanece inactivo</b> porque Intelfon no ocupa ese modelo de negocio. Por eso no verá "
            "la opción de Reintegro en el menú mientras esté apagado.",
            s["body"],
        )
    )

    story.append(Paragraph("2. Cómo entrar a la plataforma", s["h1"]))
    story.append(Paragraph("2.1 Requisitos", s["h2"]))
    story.append(
        bullets(
            [
                "URL de la aplicación publicada (ambiente Coolify / Iakimi).",
                "<b>Celular recomendado</b> con ubicación / GPS activos (uso cotidiano).",
                "En PC también se puede usar, pero el GPS puede ser menos preciso (fallback por red).",
                "En Guatemala: si la URL está bloqueada en la red corporativa, usar datos móviles u otra red.",
            ]
        )
    )
    story.append(Paragraph("2.2 Pasos de login", s["h2"]))
    story.append(
        bullets(
            [
                "Abrir la URL en el navegador.",
                "Escribir <b>correo</b> (o alias) y <b>contraseña</b>.",
                "Entrar. El sistema redirige según rol: Administrador → /admin ; Jefe / Vendedor → Inicio (/).",
                "Para cambiar contraseña: menú <b>Cuenta</b> → contraseña actual + nueva.",
            ]
        )
    )

    story.append(Paragraph("3. Credenciales por defecto (piloto)", s["h1"]))
    story.append(
        Paragraph(
            "Convención para ejecutivos: <b>parte local del correo en minúsculas + 12345</b>. "
            "Ejemplo: Cabrego@red.com.sv → <b>cabrego12345</b>. Si el usuario ya cambió la clave, vale la nueva.",
            s["body"],
        )
    )
    story.append(Paragraph("3.1 Administradores (uno por país)", s["h2"]))
    story.append(
        tbl(
            ["País", "Correo / usuario", "Contraseña piloto", "Notas"],
            [
                ["SV", "admin@red.com.sv (alias admin)", "Ventas1234", "Administrador El Salvador"],
                ["GT", "admin@red.com.gt", "Ventas1234 (al crear)", "Administrador Guatemala"],
            ],
            widths=[2 * cm, 5.5 * cm, 4.3 * cm, 5 * cm],
        )
    )
    story.append(Paragraph("3.2 El Salvador", s["h2"]))
    story.append(
        tbl(
            ["Perfil", "Correo", "Contraseña por defecto"],
            [
                ["Jefe (piloto)", "Cabrego@red.com.sv", "cabrego12345"],
                ["Jefe (si activo)", "emendez@red.com.sv", "emendez12345"],
                ["Vendedor", "Eevides@red.com.sv", "eevides12345"],
                ["Vendedor", "Ahernandez@red.com.sv", "ahernandez12345"],
                ["Vendedor", "Paguilar@red.com.sv", "paguilar12345"],
                ["Vendedor", "Mceron@red.com.sv", "mceron12345"],
                ["Vendedor", "Ckreitz@red.com.sv", "ckreitz12345"],
            ],
            widths=[3.5 * cm, 7.5 * cm, 5.8 * cm],
        )
    )
    story.append(Paragraph("3.3 Guatemala", s["h2"]))
    story.append(
        tbl(
            ["Perfil", "Correo", "Contraseña por defecto"],
            [
                ["Jefa (si rol jefe)", "Alondono@red.com.gt", "alondono12345"],
                ["Vendedor", "ohernandez@red.com.gt", "ohernandez12345"],
                ["Vendedor", "jflores@red.com.gt", "jflores12345"],
                ["Vendedor", "sconde@red.com.gt", "sconde12345"],
                ["Vendedor", "gherrera@red.com.gt", "gherrera12345"],
                ["Vendedor", "Rfuentes@red.com.gt", "rfuentes12345"],
                ["Vendedor", "DMORATAYA@red.com.gt (alias DMORATAYA)", "dmorataya12345"],
                ["Vendedor", "JCIFUNTES@red.com.gt (alias JCIFUNTES)", "jcifuntes12345"],
            ],
            widths=[3.5 * cm, 8.5 * cm, 4.8 * cm],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("4. Perfiles: permisos detallados", s["h1"]))

    story.append(Paragraph("4.1 Vendedor / ejecutivo", s["h2"]))
    story.append(Paragraph("<b>Puede</b>", s["h3"]))
    story.append(
        bullets(
            [
                "Registrar salida (cliente de cartera o prospección).",
                "Programar citas propias (hoy o futuras).",
                "Retroalimentar visitas pendientes en el lugar (foto + GPS destino).",
                "Gestionar su cartera de clientes / contactos.",
                "Ver su dashboard personal (salidas, pendientes, km, fotos, %).",
                "Cambiar su contraseña.",
            ]
        )
    )
    story.append(Paragraph("<b>No puede</b>", s["h3"]))
    story.append(
        bullets(
            [
                "Entrar a /admin ni crear usuarios de otros.",
                "Ver métricas de todo el país u otros equipos.",
                "Aprobar solicitudes de terceros.",
                "Usar Reintegro mientras combustible esté inactivo.",
            ]
        )
    )

    story.append(Paragraph("4.2 Jefe de ventas", s["h2"]))
    story.append(Paragraph("<b>Puede</b>", s["h3"]))
    story.append(
        bullets(
            [
                "Todo lo del vendedor.",
                "Agendar citas para vendedores de su equipo (correo_jefe = su correo).",
                "Ver dashboard del equipo.",
                "Bandeja de solicitudes del equipo (/solicitudes).",
            ]
        )
    )
    story.append(Paragraph("<b>No puede</b>", s["h3"]))
    story.append(
        bullets(
            [
                "Configuración global, importación masiva Excel, catálogos globales.",
                "Administrar usuarios de otros países (eso es administrador).",
            ]
        )
    )

    story.append(Paragraph("4.3 Administrador", s["h2"]))
    story.append(
        bullets(
            [
                "Panel /admin completo: configuración (combustible global, webhook, API key).",
                "Base de datos: ejecutivos, clientes, importar Excel.",
                "Usuarios, catálogos, historial, solicitudes, dashboard global.",
                "Debe existir <b>admin SV y admin GT</b>. No usar admin como ejecutivo de campo diario.",
            ]
        )
    )

    story.append(Paragraph("5. Mapa de rutas (pantallas)", s["h1"]))
    story.append(
        tbl(
            ["Ruta", "Quién", "Para qué"],
            [
                ["/", "Vendedor / jefe", "Inicio / menú de acciones"],
                ["/salida", "Vendedor / jefe", "Registrar salida + GPS origen"],
                ["/visita · /visita/:id", "Vendedor / jefe", "Pendientes / cerrar visita + GPS destino + foto"],
                ["/citas", "Vendedor / jefe", "Programar visitas"],
                ["/cartera", "Vendedor / jefe", "Clientes y contactos"],
                ["/dashboard", "Vendedor / jefe", "Métricas del alcance entregado"],
                ["/solicitudes", "Solo jefe", "Aprobaciones del equipo"],
                ["/reintegro", "Solo si combustible activo", "Viáticos (hoy inactivo)"],
                ["/cuenta", "Todos", "Cambiar contraseña"],
                ["/admin …", "Admin", "Administración completa"],
            ],
            widths=[4.2 * cm, 3.8 * cm, 8.8 * cm],
        )
    )

    story.append(Paragraph("6. Flujo completo de la plataforma", s["h1"]))
    story.append(
        Paragraph(
            "Este es el flujo operativo completo contemplado para Intelfon. Léalo de arriba abajo; "
            "es la misma lógica del alcance PELSA adaptado a la app.",
            s["body"],
        )
    )
    story.append(flow_diagram())

    story.append(Paragraph("7. Paso a paso detallado", s["h1"]))

    story.append(Paragraph("7.1 Programar una cita (opcional)", s["h2"]))
    story.append(Paragraph("Paso A — Entrar a Citas", s["step"]))
    story.append(Paragraph("Desde Inicio pulse <b>Citas</b> (o Programar visitas).", s["body"]))
    story.append(Paragraph("Paso B — Elegir tipo de destino", s["step"]))
    story.append(
        Paragraph(
            "Elija <b>Cliente</b> (de su cartera) o <b>Prospección</b> (territorio o contacto/prospecto). "
            "Complete los datos requeridos.",
            s["body"],
        )
    )
    story.append(Paragraph("Paso C — Fecha y guardar", s["step"]))
    story.append(
        Paragraph(
            "Indique la fecha (hoy o futura). Si es jefe, puede asignar la cita a un vendedor del equipo. "
            "Guarde. La cita queda disponible para convertirla en salida el día correspondiente.",
            s["body"],
        )
    )

    story.append(Paragraph("7.2 Registrar una salida (GPS de origen)", s["h2"]))
    story.append(Paragraph("Paso A — Abrir Registro de salida", s["step"]))
    story.append(
        Paragraph(
            "Desde Inicio → <b>Registro de salida</b>. Puede partir de una cita del día o registrar salida libre.",
            s["body"],
        )
    )
    story.append(Paragraph("Paso B — Destino", s["step"]))
    story.append(
        Paragraph(
            "<b>Cliente:</b> seleccione de cartera. <b>Prospección:</b> territorio o contacto (con NIT si aplica). "
            "Complete objetivo / tipo de salida y demás campos del formulario.",
            s["body"],
        )
    )
    story.append(Paragraph("Paso C — Enviar y captura GPS", s["step"]))
    story.append(
        callout(
            "Al pulsar <b>ENVIAR</b>, la plataforma <b>captura la posición GPS actual</b> del dispositivo. "
            "Esa coordenada es el <b>punto de origen</b> (salida). Autorice ubicación si el navegador lo pide. "
            "Después de enviar, la salida queda en estado <b>PENDIENTE</b> hasta que se retroalimente la visita.",
            title="GPS · ORIGEN",
        )
    )

    story.append(Paragraph("7.3 Retroalimentar la visita en el lugar (GPS de destino + distancia)", s["h2"]))
    story.append(Paragraph("Paso A — Ir al cliente / prospecto", s["step"]))
    story.append(
        Paragraph(
            "Desplácese al lugar de la visita. <b>No cierre la visita desde la oficina</b> si quiere un km real.",
            s["body"],
        )
    )
    story.append(Paragraph("Paso B — Abrir la pendiente", s["step"]))
    story.append(
        Paragraph(
            "Inicio → <b>Visitas</b> / pendientes → abra la salida correspondiente.",
            s["body"],
        )
    )
    story.append(Paragraph("Paso C — Completar reporte + foto", s["step"]))
    story.append(
        Paragraph(
            "Complete el resultado de la visita y adjunte <b>foto obligatoria</b>. Sin foto no se cierra.",
            s["body"],
        )
    )
    story.append(Paragraph("Paso D — Enviar, GPS destino y km", s["step"]))
    story.append(
        callout(
            "Al pulsar <b>ENVIAR</b> del reporte, la plataforma <b>vuelve a capturar el GPS</b> "
            "(posición en el lugar del cliente = <b>destino</b>). Con el GPS de origen (salida) y el GPS "
            "de destino (visita), <b>calcula la distancia en kilómetros</b> y la asocia a la visita. "
            "La salida pasa a <b>REALIZADA / VISITADA</b>.",
            title="GPS · DESTINO + DISTANCIA",
        )
    )
    story.append(
        Paragraph(
            "Si el km aparece en ~0 o pocos metros (ej. 10 m), es señal de que origen y destino se "
            "capturaron casi en el mismo punto (típicamente se retroalimentó en la oficina).",
            s["small"],
        )
    )

    story.append(Paragraph("7.4 Consultar el dashboard", s["h2"]))
    story.append(
        bullets(
            [
                "Inicio → <b>Dashboard</b>.",
                "Vendedor: ve sus salidas, pendientes, km, fotos y % de cumplimiento.",
                "Jefe: ve al equipo (quién programó / ejecutó / quedó pendiente).",
                "Admin: dashboard global por país / ejecutivo en /admin/dashboard.",
                "Este es el dashboard del <b>alcance entregado</b>. Mejoras pedidas después se cotizan aparte.",
            ]
        )
    )

    story.append(Paragraph("7.5 Combustible / reintegro (inactivo)", s["h2"]))
    story.append(
        Paragraph(
            "El módulo existe porque el alcance tipo PELSA lo contemplaba. Para Intelfon está "
            "<b>inactivo</b>: no aparece Reintegro y no se exige información de combustible al cerrar visitas. "
            "No es un error; es una decisión de negocio (Intelfon no usa ese modelo).",
            s["body"],
        )
    )

    story.append(Paragraph("7.6 Administrador — operaciones frecuentes", s["h2"]))
    story.append(
        bullets(
            [
                "Usuarios: alta / edición / claves / país / rol / combustible por usuario.",
                "Base de datos: ejecutivos, clientes, importar Excel de cartera.",
                "Configuración: webhook Make, combustible global, API key de lectura (/api/export/*).",
                "Dashboard global y solicitudes.",
            ]
        )
    )

    story.append(Paragraph("8. Buenas prácticas (obligatorias en operación)", s["h1"]))
    story.append(
        bullets(
            [
                "Usar <b>celular</b> con GPS para salidas y cierres reales.",
                "Registrar la salida al salir; cerrar la visita <b>en el cliente</b>.",
                "Siempre adjuntar foto al cerrar.",
                "No inventar km: si cierra en oficina, el sistema mostrará distancia mínima.",
                "Jefatura: revisar dashboard diario para pendientes del equipo.",
                "Cambiar contraseña por defecto tras el primer acceso.",
            ]
        )
    )

    story.append(Paragraph("9. Resumen de lo entregado vs lo que no está", s["h1"]))
    story.append(
        tbl(
            ["Tema", "¿Está en la plataforma hoy?"],
            [
                ["Salida + GPS origen", "Sí"],
                ["Visita en sitio + foto + GPS destino + km", "Sí"],
                ["Citas / programación", "Sí"],
                ["Cartera / prospección", "Sí"],
                ["Dashboard operativo actual", "Sí (alcance acordado)"],
                ["Combustible / reintegro", "Diseñado, INACTIVO"],
                ["Integración SAN", "No (fuera de alcance)"],
                ["Alertas mail a jefe por pendiente", "No (fuera de alcance)"],
                ["Dashboard ejecutivo transversal externo", "No (fuera de alcance; API lectura sí existe)"],
            ],
            widths=[9 * cm, 7.8 * cm],
        )
    )

    story.append(Spacer(1, 10))
    story.append(Paragraph("Manual de usuario · IAKimi · Noviembre 2026", s["small"]))

    doc = make_doc(path, title)

    def _hf(c, d):
        header_footer(c, d, title)

    doc.build(story, onFirstPage=_hf, onLaterPages=_hf)
    return path


# ---------------------------------------------------------------------------
# DOC 3
# ---------------------------------------------------------------------------
def build_fuera():
    s = S()
    path = OUT / "Fuera de alcance a cotizar.pdf"
    title = "Fuera de alcance a cotizar"
    story = []
    cover(
        story,
        s,
        "Fuera de alcance a cotizar",
        "Intelfon / RED — Gestión de Visitas<br/>Pedidos de la reunión de seguimiento · No incluidos en el alcance acordado",
        [
            ("Versión", "1.0"),
            ("Fecha", "Noviembre 2026"),
            ("Cliente", "Intelfon / RED (SV · GT)"),
            ("Clasificación", "Comercial / cotización"),
        ],
    )

    story.append(
        callout(
            "Estos puntos <b>no estaban</b> en el alcance acordado de la adaptación PELSA entregada "
            "(ver documento <b>Alcance acordado con IAKimi</b>). No se desarrollan en garantía. "
            "Se listan, se validan y se <b>cotizan por separado</b> antes de cualquier implementación."
        )
    )

    story.append(Paragraph("1. Recordatorio del alcance ya entregado", s["h1"]))
    story.append(
        Paragraph(
            "Ya está entregado (y documentado en el Manual): app web, salida con GPS origen, "
            "visita en sitio con foto + GPS destino + cálculo de distancia, citas, cartera/prospección, "
            "dashboard operativo actual, roles, admin por país, combustible <b>diseñado pero inactivo</b>, "
            "y API de lectura. Lo de abajo es <b>adicional</b>.",
            s["body"],
        )
    )

    story.append(Paragraph("2. Lista de pedidos fuera de alcance", s["h1"]))
    story.append(
        tbl(
            ["#", "Pedido", "Por qué está fuera / notas"],
            [
                [
                    "A",
                    "Alerta a jefe si no retroalimentan (correo / push)",
                    "Hoy solo queda pendiente en app; no dispara aviso automático",
                ],
                [
                    "B",
                    "Dashboard jefe «de un vistazo» + drill-down clicable por salida",
                    "Más allá del KPI del dashboard entregado",
                ],
                [
                    "C",
                    "% cartera visitada; separar cliente vs prospecto en métricas",
                    "Enfoque / métrica nueva de jefatura",
                ],
                [
                    "D",
                    "Desactivar usuario sin borrar (historial)",
                    "Pedido operativo post-entrega (ej. Alexandra)",
                ],
                [
                    "E",
                    "Disciplina GPS reforzada (geocerca / bloquear cierre en oficina)",
                    "Hoy se calcula km; no se bloquea el cierre en origen",
                ],
                [
                    "F",
                    "Ampliar a SAC / mensajeros / «todo el que salga»",
                    "Cambia el piloto de ventas acordado",
                ],
                [
                    "G",
                    "Integración SAN (prospecto → cliente)",
                    "Explícitamente fuera del alcance actual",
                ],
                [
                    "H",
                    "Dashboard externo transversal + documentación API extendida",
                    "Consumir visitas + otros inputs en un solo tablero",
                ],
                [
                    "I",
                    "Hosting en servers del cliente / cobro de infraestructura",
                    "Hoy corre en Coolify Iakimi; decisión comercial aparte",
                ],
                [
                    "J",
                    "Mockup / dashboard «fuerte» unificado (forecast, cartera, etc.)",
                    "Pedido de reunión; no era entregable PELSA adaptado",
                ],
            ],
            widths=[1.1 * cm, 6.2 * cm, 9.5 * cm],
        )
    )

    story.append(Paragraph("3. Contexto operativo que no es feature", s["h1"]))
    story.append(
        bullets(
            [
                "Bloqueo de URL en red Guatemala (Nilsson / proveedor) → workaround celular / datos.",
                "Primer día de uso: pocos registros; km anómalos posibles por pruebas en oficina.",
                "La falta de manual en la reunión queda cubierta con <b>Manual de usuario.pdf</b>.",
            ]
        )
    )

    story.append(Paragraph("4. Proceso comercial acordado", s["h1"]))
    story.append(
        bullets(
            [
                "<b>Alcance acordado con IAKimi.pdf</b> = lo entregado / congelado.",
                "<b>Manual de usuario.pdf</b> = cómo se usa lo entregado (incluye GPS y combustible inactivo).",
                "<b>Este documento</b> = backlog A–J cotizable.",
                "No implementar A–J hasta cotización y aprobación explícita del cliente / gerencia.",
            ]
        )
    )

    story.append(Paragraph("5. Decisiones ya tomadas", s["h1"]))
    story.append(
        tbl(
            ["Tema", "Decisión"],
            [
                ["Dashboard actual en la app", "Es lo entregado; mejoras = cotizar (B, C, J, H)"],
                ["Combustible / viáticos", "En alcance, inactivo (Intelfon no usa el modelo)"],
                ["SAN", "Fuera del alcance actual (G)"],
                ["Admin", "Uno SV y uno GT"],
                ["GPS origen + destino + km", "Dentro del alcance; ya documentado en el Manual"],
                ["Requerimiento original", "Flujo Make/Google PELSA del inicio del proyecto"],
            ],
            widths=[5.5 * cm, 11.3 * cm],
        )
    )

    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "Próximo paso: estimar horas por ítem A–J y devolver cotización a gerencia / cliente.",
            s["body"],
        )
    )
    story.append(Paragraph("Fuera de alcance a cotizar · IAKimi · Noviembre 2026", s["small"]))

    doc = make_doc(path, title)

    def _hf(c, d):
        header_footer(c, d, title)

    doc.build(story, onFirstPage=_hf, onLaterPages=_hf)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if not LOGO.exists():
        raise SystemExit(f"Logo no encontrado: {LOGO}")

    # quitar PDFs anteriores
    for old in [
        "RED_Gestion_Visitas_01_Alcance_Entregado_PELSA.pdf",
        "RED_Gestion_Visitas_02_Manual_de_Usuario.pdf",
        "RED_Gestion_Visitas_03_Fuera_de_Alcance_Cotizar.pdf",
        "Alcance acordado con IAKimi.pdf",
        "Manual de usuario.pdf",
        "Fuera de alcance a cotizar.pdf",
    ]:
        p = OUT / old
        if p.exists():
            p.unlink()
            print("removed", p.name)

    paths = [build_alcance(), build_manual(), build_fuera()]
    print("OK")
    for p in paths:
        print(p, p.stat().st_size)


if __name__ == "__main__":
    main()
