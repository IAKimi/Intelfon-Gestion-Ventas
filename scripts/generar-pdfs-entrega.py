# -*- coding: utf-8 -*-
"""Genera PDFs de alcance, manual de usuario y fuera de alcance → Descargas."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
    ListFlowable,
    ListItem,
    HRFlowable,
)

OUT = Path.home() / "Downloads"
RED = colors.HexColor("#B91C1C")
SLATE = colors.HexColor("#334155")
LIGHT = colors.HexColor("#F8FAFC")
BORDER = colors.HexColor("#E2E8F0")
MUTED = colors.HexColor("#64748B")


def styles():
    base = getSampleStyleSheet()
    return {
        "cover": ParagraphStyle(
            "cover",
            parent=base["Title"],
            fontSize=22,
            textColor=RED,
            spaceAfter=8,
            alignment=TA_CENTER,
            leading=28,
        ),
        "sub": ParagraphStyle(
            "sub",
            parent=base["Normal"],
            fontSize=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontSize=14,
            textColor=RED,
            spaceBefore=14,
            spaceAfter=8,
            leading=18,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontSize=11.5,
            textColor=SLATE,
            spaceBefore=10,
            spaceAfter=6,
            leading=15,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontSize=9.5,
            textColor=SLATE,
            alignment=TA_JUSTIFY,
            leading=13,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontSize=9.5,
            textColor=SLATE,
            leading=12.5,
            leftIndent=4,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontSize=8,
            textColor=MUTED,
            leading=11,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontSize=8,
            textColor=SLATE,
            leading=10.5,
        ),
        "cell_h": ParagraphStyle(
            "cell_h",
            parent=base["Normal"],
            fontSize=8,
            textColor=colors.white,
            leading=10.5,
            fontName="Helvetica-Bold",
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["Normal"],
            fontSize=9,
            textColor=SLATE,
            leading=12,
            leftIndent=6,
            rightIndent=6,
        ),
        "mono": ParagraphStyle(
            "mono",
            parent=base["Code"],
            fontSize=8,
            textColor=SLATE,
            leading=11,
            fontName="Courier",
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontSize=7.5,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
    }


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(1.8 * cm, 1.4 * cm, letter[0] - 1.8 * cm, 1.4 * cm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(1.8 * cm, 0.9 * cm, "RED · Gestión de Visitas · Confidencial")
    canvas.drawRightString(letter[0] - 1.8 * cm, 0.9 * cm, f"Pág. {doc.page}")
    canvas.restoreState()


def hr():
    return HRFlowable(width="100%", thickness=1, color=RED, spaceBefore=4, spaceAfter=10)


def table(headers, rows, col_widths=None):
    s = styles()
    data = [[Paragraph(h, s["cell_h"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), s["cell"]) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), RED),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (-1, -1), LIGHT),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [LIGHT, colors.white]),
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
    s = styles()
    return ListFlowable(
        [ListItem(Paragraph(i, s["bullet"]), leftIndent=12, bulletColor=RED) for i in items],
        bulletType="bullet",
        start="•",
        leftIndent=12,
        bulletFontSize=9,
    )


def callout_box(text):
    s = styles()
    inner = Table([[Paragraph(text, s["callout"])]], colWidths=[16.5 * cm])
    inner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF2F2")),
                ("BOX", (0, 0), (-1, -1), 1, RED),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return inner


def flow_box(lines):
    """Cajita ASCII/texto para flujograma."""
    s = styles()
    body = "<br/>".join(lines)
    inner = Table([[Paragraph(body, s["mono"])]], colWidths=[16.5 * cm])
    inner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
                ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return inner


def make_doc(path, title):
    return SimpleDocTemplate(
        str(path),
        pagesize=letter,
        leftMargin=1.8 * cm,
        rightMargin=1.8 * cm,
        topMargin=1.6 * cm,
        bottomMargin=2 * cm,
        title=title,
        author="Iakimi / RED",
    )


# ---------------------------------------------------------------------------
# DOC 1 — Alcance entregado
# ---------------------------------------------------------------------------
def build_alcance():
    s = styles()
    path = OUT / "RED_Gestion_Visitas_01_Alcance_Entregado_PELSA.pdf"
    story = []
    story.append(Paragraph("RED · Gestión de Visitas", s["cover"]))
    story.append(Paragraph("Documento 1 — Alcance contemplado (adaptación flujo tipo PELSA)", s["sub"]))
    story.append(Paragraph("Entrega congelada · Validación comercial / operativa", s["sub"]))
    story.append(hr())
    story.append(
        callout_box(
            "<b>Importante.</b> Todo lo descrito en este documento es lo que se contempló bajo el alcance "
            "de la <b>adaptación del flujo tipo PELSA</b> para RED. Cualquier pedido posterior a la entrega "
            "(reunión de seguimiento u otros) se lista y cotiza por separado."
        )
    )
    story.append(Paragraph("1. Origen del proyecto", s["h1"]))
    story.append(
        Paragraph(
            "La solución nace del flujo operativo de visitas que se usaba en otra compañía (PELSA): "
            "programación / registro de salida / reporte de visita / kilometraje, orquestado con "
            "<b>Google Sheets + Make</b>. Ese flujo se adaptó a una <b>aplicación web publicada en línea</b> "
            "para RED (El Salvador y Guatemala), con matices propios: cartera por ejecutivo, roles "
            "(vendedor / jefe / administrador) y dashboard dentro de la plataforma.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Fuente de verdad del alcance original:</b> el flujo Make / Google de PELSA compartido al "
            "inicio del proyecto (no los pedidos surgidos en reuniones posteriores a la entrega).",
            s["body"],
        )
    )

    story.append(Paragraph("2. Qué incluye el alcance entregado", s["h1"]))
    story.append(
        table(
            ["Bloque", "Estado en alcance"],
            [
                ["Aplicación web (login, roles, uso celular / PC)", "Incluido"],
                ["Registro de salida con captura GPS al enviar", "Incluido"],
                ["Programación de visitas / citas (hoy o días futuros)", "Incluido"],
                ["Retroalimentación de visita (cerrar salida pendiente)", "Incluido"],
                ["Foto obligatoria al cerrar visita", "Incluido"],
                ["Destino cliente (cartera) o prospección (texto / contacto)", "Incluido"],
                ["Cartera por ejecutivo (carga / administración)", "Incluido"],
                [
                    "Dashboard actual (salidas, pendientes, km, foto, % cumplimiento, filtros)",
                    "Incluido — esto es lo entregado",
                ],
                ["Perfiles: vendedor, jefe de ventas, administrador", "Incluido"],
                [
                    "Admin global SV (admin@red.com.sv) y admin GT (admin@red.com.gt)",
                    "Incluido (GT documentado / a asegurar en entrega)",
                ],
                [
                    "Combustible / viáticos / reintegro",
                    "Dentro del alcance, INACTIVO (Legacy; RED no lo usa hoy)",
                ],
                [
                    "API de lectura /api/export/* (consulta)",
                    "Capacidad técnica incluida; consumo externo = fase aparte",
                ],
                ["Manual de usuario de la plataforma", "Debe acompañar la entrega"],
            ],
            col_widths=[10.5 * cm, 6 * cm],
        )
    )

    story.append(Paragraph("3. Qué no incluye este alcance (se cotiza aparte)", s["h1"]))
    story.append(
        bullets(
            [
                "Integración SAN (alta de prospecto → cliente en ERP).",
                "Alertas automáticas a jefatura (correo / push) por no retroalimentar.",
                "Dashboard robusto transversal (forecast, cartera unificada fuera de la app, etc.).",
                "Geocerca / bloqueo si se retroalimenta en la misma posición de la oficina.",
                "Desactivar usuario sin borrar (historial) si no está en la entrega actual.",
                "Ampliación formal a servicio al cliente / mensajeros más allá del piloto de ventas.",
                "Migración a servidores del cliente y modelo de cobro de hosting.",
                "Todo lo listado en el Documento 3 (pedidos de la reunión de seguimiento).",
            ]
        )
    )

    story.append(Paragraph("4. Criterio de cierre (Eduardo)", s["h1"]))
    story.append(
        bullets(
            [
                "Congelar y validar únicamente lo de la sección 2.",
                "Listar lo nuevo de la reunión → Documento 3 → cotización aparte.",
                "No asumir en garantía lo que no estaba en el alcance PELSA adaptado.",
                "Si el cliente pide algo no listado aquí: cotizar antes de desarrollar.",
            ]
        )
    )

    story.append(Paragraph("5. Combustible y viáticos", s["h1"]))
    story.append(
        Paragraph(
            "El módulo de combustible / reintegro <b>sí forma parte del alcance Intelfon / PELSA adaptado</b>, "
            "pero permanece <b>inactivo</b> en RED porque el cliente no lo utiliza. La plataforma puede "
            "activarlo por configuración (global o por usuario) sin redefinir el alcance base.",
            s["body"],
        )
    )

    story.append(Spacer(1, 12))
    story.append(Paragraph("Documento de alcance · Noviembre 2026", s["small"]))

    doc = make_doc(path, "Alcance entregado PELSA → RED")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


# ---------------------------------------------------------------------------
# DOC 2 — Manual de usuario
# ---------------------------------------------------------------------------
def build_manual():
    s = styles()
    path = OUT / "RED_Gestion_Visitas_02_Manual_de_Usuario.pdf"
    story = []
    story.append(Paragraph("RED · Gestión de Visitas", s["cover"]))
    story.append(Paragraph("Documento 2 — Manual de usuario", s["sub"]))
    story.append(Paragraph("Credenciales · Roles · Rutas · Flujos operativos", s["sub"]))
    story.append(hr())

    story.append(
        callout_box(
            "<b>Uso recomendado:</b> celular con ubicación / GPS activo. En PC el GPS puede ser impreciso "
            "(fallback por red). En Guatemala, si la URL está bloqueada en la red corporativa, usar datos "
            "móviles u otra red."
        )
    )

    story.append(Paragraph("1. Cómo entrar", s["h1"]))
    story.append(
        bullets(
            [
                "Abrir la URL de la plataforma (ambiente publicado en Coolify / Iakimi).",
                "Ingresar correo (o alias) + contraseña.",
                "El sistema redirige según rol: administrador → /admin ; jefe / vendedor → inicio (/).",
                "Cambio de contraseña: menú Cuenta → contraseña actual + nueva.",
            ]
        )
    )

    story.append(Paragraph("2. Credenciales por defecto (piloto)", s["h1"]))
    story.append(
        Paragraph(
            "Convención de contraseña para ejecutivos: <b>parte local del correo en minúsculas + 12345</b>. "
            "Ejemplo: Cabrego@red.com.sv → <b>cabrego12345</b>.",
            s["body"],
        )
    )

    story.append(Paragraph("2.1 Administradores", s["h2"]))
    story.append(
        table(
            ["País", "Usuario / correo", "Contraseña piloto", "Notas"],
            [
                ["SV", "admin@red.com.sv (alias admin)", "Ventas1234", "Admin global El Salvador"],
                [
                    "GT",
                    "admin@red.com.gt",
                    "Ventas1234 (definir al crear)",
                    "Debe existir un admin Guatemala aparte",
                ],
            ],
            col_widths=[2.2 * cm, 5.5 * cm, 4 * cm, 4.8 * cm],
        )
    )

    story.append(Paragraph("2.2 El Salvador — jefatura y ventas", s["h2"]))
    story.append(
        table(
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
            col_widths=[3.5 * cm, 7 * cm, 6 * cm],
        )
    )

    story.append(Paragraph("2.3 Guatemala — jefatura y ventas", s["h2"]))
    story.append(
        table(
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
            col_widths=[3.5 * cm, 8 * cm, 5 * cm],
        )
    )
    story.append(
        Paragraph(
            "Nota: si un usuario cambió su clave desde Cuenta, la vigente es la nueva. "
            "El administrador puede restablecer claves desde Admin → Usuarios.",
            s["small"],
        )
    )

    story.append(Paragraph("3. Perfiles: qué pueden y qué no pueden", s["h1"]))

    story.append(Paragraph("3.1 Vendedor / ejecutivo", s["h2"]))
    story.append(Paragraph("<b>Puede</b>", s["body"]))
    story.append(
        bullets(
            [
                "Registrar salida (cliente o prospección) con GPS al enviar.",
                "Programar citas propias (hoy o días futuros).",
                "Retroalimentar visitas pendientes (foto + GPS al cerrar).",
                "Gestionar su cartera de clientes / contactos.",
                "Ver su dashboard personal.",
                "Cambiar su contraseña.",
            ]
        )
    )
    story.append(Paragraph("<b>No puede</b>", s["body"]))
    story.append(
        bullets(
            [
                "Entrar al panel /admin.",
                "Aprobar solicitudes de otros.",
                "Ver métricas de todo el país / otros equipos.",
                "Solicitar reintegro mientras combustible esté Legacy / inactivo.",
            ]
        )
    )

    story.append(Paragraph("3.2 Jefe de ventas", s["h2"]))
    story.append(Paragraph("<b>Puede</b>", s["body"]))
    story.append(
        bullets(
            [
                "Todo lo del vendedor.",
                "Agendar citas para su equipo (vendedores con correo_jefe = su correo).",
                "Ver dashboard del equipo.",
                "Bandeja de solicitudes del equipo (/solicitudes).",
            ]
        )
    )
    story.append(Paragraph("<b>No puede</b>", s["body"]))
    story.append(
        bullets(
            [
                "Configuración global, importación masiva Excel, catálogos globales.",
                "Alta / edición de usuarios de otros países (eso es administrador).",
            ]
        )
    )

    story.append(Paragraph("3.3 Administrador", s["h2"]))
    story.append(Paragraph("<b>Puede</b>", s["body"]))
    story.append(
        bullets(
            [
                "Panel /admin completo: configuración (combustible global, webhook, API key de export).",
                "Base de datos: ejecutivos, clientes, importación Excel.",
                "Usuarios, catálogos, historial de contactos, solicitudes, dashboard global.",
            ]
        )
    )
    story.append(
        Paragraph(
            "Debe haber <b>un admin por país</b> en la entrega: admin@red.com.sv y admin@red.com.gt. "
            "No usar la cuenta admin como ejecutivo de campo en el día a día.",
            s["body"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("4. Alcances activos hoy", s["h1"]))
    story.append(
        table(
            ["Función", "Estado"],
            [
                ["Salida + GPS al enviar", "Activo"],
                ["Visita + foto + GPS al cerrar", "Activo"],
                ["Citas / programación", "Activo"],
                ["Cartera cliente / prospección", "Activo"],
                ["Dashboard actual en la app", "Activo (alcance entregado)"],
                ["Combustible / reintegro", "En alcance, INACTIVO"],
                ["Solicitudes vendedor → SAN", "No (SAN fuera de alcance)"],
                ["Alertas mail a jefe por pendiente", "No"],
            ],
            col_widths=[9 * cm, 7.5 * cm],
        )
    )

    story.append(Paragraph("5. Mapa de rutas", s["h1"]))
    story.append(
        table(
            ["Ruta", "Quién", "Para qué"],
            [
                ["/", "Vendedor / jefe", "Inicio / menú"],
                ["/salida", "Vendedor / jefe", "Registrar salida"],
                ["/visita · /visita/:id", "Vendedor / jefe", "Pendientes / cerrar visita"],
                ["/citas", "Vendedor / jefe", "Programar visitas"],
                ["/cartera", "Vendedor / jefe", "Clientes y contactos"],
                ["/dashboard", "Vendedor / jefe", "Métricas"],
                ["/solicitudes", "Solo jefe", "Aprobaciones del equipo"],
                ["/reintegro", "Si combustible activo", "Viáticos"],
                ["/cuenta", "Todos", "Cambiar contraseña"],
                ["/admin …", "Admin", "Administración"],
            ],
            col_widths=[4.5 * cm, 4 * cm, 8 * cm],
        )
    )

    story.append(Paragraph("6. Flujo operativo completo", s["h1"]))
    story.append(
        Paragraph(
            "Flujo tipo PELSA adaptado a la app. La disciplina GPS es: capturar ubicación al "
            "<b>registrar salida</b> (origen) y al <b>cerrar visita</b> (destino), en el lugar real.",
            s["body"],
        )
    )
    story.append(
        flow_box(
            [
                "┌─────────────┐",
                "│   LOGIN     │  correo + contraseña",
                "└──────┬──────┘",
                "       │",
                "       ▼",
                "  ¿Admin? ──sí──► /admin (config, usuarios, BD, dashboard global)",
                "       │ no",
                "       ▼",
                "┌─────────────────────┐",
                "│ INICIO (vendedor/jefe)│",
                "└──────────┬──────────┘",
                "           │",
                "     ┌─────┴─────┐",
                "     ▼           ▼",
                " PROGRAMAR     REGISTRAR SALIDA",
                "   CITA          (cliente | prospección)",
                " (opcional)           │",
                "     │                ▼",
                "     └──────►  GPS origen al ENVIAR",
                "                      │",
                "                      ▼",
                "              Salida PENDIENTE",
                "                      │",
                "                      ▼",
                "         RETROALIMENTAR VISITA",
                "         (foto obligatoria + GPS destino)",
                "                      │",
                "                      ▼",
                "              Visita REALIZADA",
                "              (km = distancia origen→destino)",
                "                      │",
                "                      ▼",
                "                 DASHBOARD",
                "        (cumplimiento, pendientes, km, fotos)",
            ]
        )
    )

    story.append(Spacer(1, 8))
    story.append(Paragraph("6.1 Paso a paso — vendedor", s["h2"]))
    story.append(
        bullets(
            [
                "<b>Programar (opcional):</b> Inicio → Citas → elegir Cliente o Prospección → fecha → guardar.",
                "<b>Salir:</b> Inicio → Registro de salida → elegir destino → completar formulario → Enviar (aceptar GPS).",
                "<b>En el cliente:</b> Inicio → Visitas / pendientes → abrir la salida → foto + comentarios → Enviar (GPS en sitio).",
                "<b>Revisar:</b> Inicio → Dashboard → ver pendientes, km y % de cumplimiento.",
            ]
        )
    )

    story.append(Paragraph("6.2 Paso a paso — jefe", s["h2"]))
    story.append(
        bullets(
            [
                "Puede programar citas para sí o para un vendedor de su equipo.",
                "Dashboard muestra métricas del equipo (no solo las propias).",
                "Solicitudes: revisar / aprobar o rechazar altas del equipo.",
            ]
        )
    )

    story.append(Paragraph("6.3 Paso a paso — administrador", s["h2"]))
    story.append(
        bullets(
            [
                "Login → /admin.",
                "Usuarios: altas, claves, país, combustible por usuario.",
                "Base de datos: ejecutivos / clientes / importar Excel.",
                "Configuración: webhook Make, combustible global, API key de lectura.",
                "Dashboard global: visitas y pendientes por ejecutivo / país.",
            ]
        )
    )

    story.append(Paragraph("7. Buenas prácticas GPS y foto", s["h1"]))
    story.append(
        bullets(
            [
                "Retroalimentar <b>en el lugar de la visita</b>, no al regresar a la oficina (si no, el km sale ~0).",
                "Foto es obligatoria al cerrar la visita.",
                "Si Obed (u otro) muestra 10 m: probable retroalimentación en la misma posición de origen.",
                "Preferir celular; en PC verificar permisos de ubicación o usar red con IP usable.",
            ]
        )
    )

    story.append(Paragraph("8. Combustible / viáticos", s["h1"]))
    story.append(
        Paragraph(
            "El módulo existe en la plataforma (alcance PELSA) pero está <b>inactivo</b> para RED "
            "(pago Legacy Intelfon). No aparece Reintegro en el menú mientras esté apagado. "
            "Activarlo es configuración admin, no un desarrollo nuevo de alcance.",
            s["body"],
        )
    )

    story.append(Spacer(1, 12))
    story.append(Paragraph("Manual de usuario · Noviembre 2026", s["small"]))

    doc = make_doc(path, "Manual de usuario RED Gestión de Visitas")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


# ---------------------------------------------------------------------------
# DOC 3 — Fuera de alcance (reunión)
# ---------------------------------------------------------------------------
def build_fuera():
    s = styles()
    path = OUT / "RED_Gestion_Visitas_03_Fuera_de_Alcance_Cotizar.pdf"
    story = []
    story.append(Paragraph("RED · Gestión de Visitas", s["cover"]))
    story.append(Paragraph("Documento 3 — Pedidos fuera del alcance actual", s["sub"]))
    story.append(Paragraph("Reunión de seguimiento · Cotizar por separado", s["sub"]))
    story.append(hr())

    story.append(
        callout_box(
            "<b>Regla.</b> Estos puntos surgieron en la reunión de seguimiento (segmento app de visitas). "
            "<b>No estaban</b> en el alcance de la adaptación PELSA entregada. No se desarrollan en "
            "garantía: se listan, se validan con el cliente y se <b>cotizan aparte</b>."
        )
    )

    story.append(Paragraph("1. Lista de pedidos nuevos", s["h1"]))
    story.append(
        table(
            ["#", "Pedido", "Notas de la reunión"],
            [
                [
                    "A",
                    "Alerta a jefe si no retroalimentan (correo / push)",
                    "Hoy solo queda pendiente en app; no dispara aviso",
                ],
                [
                    "B",
                    "Dashboard jefe «de un vistazo» + drill-down clicable",
                    "Más allá del KPI actual; detalle por salida al clic",
                ],
                [
                    "C",
                    "% cartera visitada; separar cliente vs prospecto",
                    "Métrica / enfoque nuevo para jefatura",
                ],
                [
                    "D",
                    "Desactivar usuario (no borrar) por historial",
                    "Ej. Alexandra; evitar pérdida de historial",
                ],
                [
                    "E",
                    "Disciplina GPS reforzada (cero km / geocerca oficina)",
                    "Evidenciar vs bloquear retroalimentación en origen",
                ],
                [
                    "F",
                    "Ampliar roles (SAC, mensajeros, «todo el que salga»)",
                    "Cambio de alcance del piloto de ventas",
                ],
                [
                    "G",
                    "Integración SAN (prospecto → cliente)",
                    "Fuera de alcance actual; genera fricción si se fuerza a mano",
                ],
                [
                    "H",
                    "API de consulta documentada + dashboard externo",
                    "JC: un dashboard transversal que consuma varios inputs",
                ],
                [
                    "I",
                    "Hosting en servers del cliente / modelo de cobro",
                    "Pregunta abierta; hoy está en Coolify Iakimi",
                ],
                [
                    "J",
                    "Mockup HTML de dashboard «fuerte» / unificado",
                    "Eduardo mockup; JC prefiere dashboard transversal",
                ],
            ],
            col_widths=[1.2 * cm, 6.5 * cm, 8.8 * cm],
        )
    )

    story.append(Paragraph("2. Contexto operativo (no es feature, pero impacta)", s["h1"]))
    story.append(
        bullets(
            [
                "Bloqueo de URL en red Guatemala (Nilsson / proveedor) → workaround celular / datos.",
                "Uso real del primer día: pocos registros; algunos km anómalos (posible prueba en oficina).",
                "Sin manual al momento de la reunión → se cubre con Documento 2.",
            ]
        )
    )

    story.append(Paragraph("3. Proceso acordado", s["h1"]))
    story.append(
        bullets(
            [
                "Documento 1 = alcance congelado (PELSA adaptado).",
                "Documento 2 = manual de entrega.",
                "Este Documento 3 = backlog cotizable.",
                "No implementar A–J hasta cotización y aprobación explícita.",
            ]
        )
    )

    story.append(Paragraph("4. Decisiones ya tomadas sobre el alcance", s["h1"]))
    story.append(
        table(
            ["Tema", "Decisión"],
            [
                ["Dashboard actual en la app", "Es lo entregado; mejoras = cotizar"],
                ["Combustible / viáticos", "En alcance, inactivo"],
                ["SAN", "Fuera del alcance actual"],
                ["Admin", "Uno SV y uno GT (admin@red.com.sv / .gt)"],
                ["Requerimiento original", "Flujo Make/Google PELSA del inicio del proyecto"],
            ],
            col_widths=[6 * cm, 10.5 * cm],
        )
    )

    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "Próximo paso: estimar horas por ítem A–J y devolver cotización al ingeniero / Eduardo.",
            s["body"],
        )
    )
    story.append(Paragraph("Fuera de alcance · Noviembre 2026", s["small"]))

    doc = make_doc(path, "Fuera de alcance — cotizar aparte")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    paths = [build_alcance(), build_manual(), build_fuera()]
    print("OK")
    for p in paths:
        print(p)


if __name__ == "__main__":
    main()
