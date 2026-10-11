#!/usr/bin/env python3
"""Build AURELIA FYP presentation (.pptx) with backgrounds + animations.

Unknown fields (team names, literature sources, reference citations, calendar
dates) are left as blank underscore lines for manual fill-in.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Iterable
from zipfile import ZipFile, ZIP_DEFLATED

from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt
from lxml import etree

OUT = Path(__file__).resolve().parent / "FYP_Presentation_AURELIA.pptx"
TMP = Path(__file__).resolve().parent / "_pptx_assets"
TMP.mkdir(exist_ok=True)

# Widescreen 16:9
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

# Palette — deep night + warm gold (AURELIA)
GOLD = RGBColor(0xD4, 0xAF, 0x37)
GOLD_LIGHT = RGBColor(0xF0, 0xD7, 0x8C)
CREAM = RGBColor(0xF7, 0xF1, 0xE3)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
MUTED = RGBColor(0xB8, 0xB0, 0xA0)
DARK_TEXT = RGBColor(0x1A, 0x14, 0x0A)
CARD_BG = RGBColor(0x1E, 0x18, 0x12)
ACCENT_LINE = RGBColor(0xC9, 0xA2, 0x27)

NSMAP = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def make_background(name: str, variant: str = "main") -> Path:
    """Create a soft gradient + vignette + subtle gold glow background."""
    w, h = 1920, 1080
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)

    if variant == "title":
        c1, c2, c3 = (12, 10, 8), (42, 28, 12), (18, 14, 10)
    elif variant == "qa":
        c1, c2, c3 = (10, 12, 18), (28, 22, 14), (14, 12, 10)
    else:
        c1, c2, c3 = (14, 12, 10), (36, 26, 14), (16, 14, 12)

    for y in range(h):
        t = y / (h - 1)
        if t < 0.55:
            u = t / 0.55
            r, g, b = lerp(c1[0], c2[0], u), lerp(c1[1], c2[1], u), lerp(c1[2], c2[2], u)
        else:
            u = (t - 0.55) / 0.45
            r, g, b = lerp(c2[0], c3[0], u), lerp(c2[1], c3[1], u), lerp(c2[2], c3[2], u)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # Soft gold radial glow (top-right / center)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    cx, cy = (w * 0.72, h * 0.28) if variant != "title" else (w * 0.5, h * 0.35)
    for i in range(28, 0, -1):
        rad = int(420 * (i / 28))
        alpha = int(18 * (i / 28))
        gdraw.ellipse(
            [cx - rad, cy - rad, cx + rad, cy + rad],
            fill=(212, 175, 55, alpha),
        )
    glow = glow.filter(ImageFilter.GaussianBlur(48))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    # Thin gold corner accents
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle([48, 48, w - 48, h - 48], outline=(212, 175, 55, 55), width=2)
    od.line([(48, 48), (220, 48)], fill=(240, 215, 140, 180), width=3)
    od.line([(48, 48), (48, 180)], fill=(240, 215, 140, 180), width=3)
    od.line([(w - 220, h - 48), (w - 48, h - 48)], fill=(240, 215, 140, 180), width=3)
    od.line([(w - 48, h - 180), (w - 48, h - 48)], fill=(240, 215, 140, 180), width=3)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    path = TMP / f"{name}.png"
    img.save(path, "PNG")
    return path


def set_run(run, text: str, size: int, color: RGBColor, bold: bool = False, font: str = "Georgia"):
    run.text = text
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold
    run.font.name = font


def add_textbox(slide, left, top, width, height, text, size=18, color=CREAM, bold=False,
                align=PP_ALIGN.LEFT, font="Georgia", anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    try:
        tf._txBody.bodyPr.set("anchor", {MSO_ANCHOR.TOP: "t", MSO_ANCHOR.MIDDLE: "ctr", MSO_ANCHOR.BOTTOM: "b"}[anchor])
    except Exception:
        pass
    p = tf.paragraphs[0]
    p.alignment = align
    set_run(p.add_run(), text, size, color, bold, font)
    return box


def add_bullets(slide, left, top, width, height, items: list[str], size=16, color=CREAM, spacing=10):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        p.space_after = Pt(spacing)
        p.level = 0
        run = p.add_run()
        set_run(run, f"•  {item}", size, color, False, "Calibri")
    return box


def add_card(slide, left, top, width, height, fill=CARD_BG):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.color.rgb = ACCENT_LINE
    shape.line.width = Pt(1.25)
    # Soften corners
    try:
        shape.adjustments[0] = 0.08
    except Exception:
        pass
    return shape


def add_gold_bar(slide, left, top, width):
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, Pt(3))
    bar.fill.solid()
    bar.fill.fore_color.rgb = GOLD
    bar.line.fill.background()
    return bar


def add_footer(slide, page: int, total: int = 12):
    add_textbox(
        slide, Inches(0.6), Inches(7.05), Inches(8), Inches(0.3),
        "BSc. Information Engg. Technology  ·  AURELIA",
        size=11, color=MUTED, font="Calibri",
    )
    add_textbox(
        slide, Inches(11.6), Inches(7.05), Inches(1.2), Inches(0.3),
        str(page), size=11, color=GOLD, align=PP_ALIGN.RIGHT, font="Calibri", bold=True,
    )


def add_title_block(slide, title: str, subtitle: str | None = None):
    add_textbox(slide, Inches(0.7), Inches(0.45), Inches(11.5), Inches(0.55),
                title, size=30, color=GOLD_LIGHT, bold=True, font="Georgia")
    add_gold_bar(slide, Inches(0.7), Inches(1.05), Inches(2.4))
    if subtitle:
        add_textbox(slide, Inches(0.7), Inches(1.2), Inches(11.5), Inches(0.4),
                    subtitle, size=14, color=MUTED, font="Calibri")
    return


def set_bg(slide, path: Path):
    pic = slide.shapes.add_picture(str(path), Inches(0), Inches(0), SLIDE_W, SLIDE_H)
    # Send to back by reordering XML
    spTree = slide.shapes._spTree
    pic_el = pic._element
    spTree.remove(pic_el)
    spTree.insert(2, pic_el)


# ---------- Animation injection ----------

def shape_ids(slide) -> list[int]:
    ids = []
    for shape in slide.shapes:
        try:
            ids.append(shape.shape_id)
        except Exception:
            pass
    return ids


def _add_entrance(child_fx, p_ns, a_ns, sid: int, next_id: list[int], delay_ms: int,
                   preset_id: str, filter_name: str, dur: str, node_type: str):
    """Add one entrance effect node (fade / wipe / fly)."""
    par = etree.SubElement(child_fx, f"{{{p_ns}}}par")
    ctn = etree.SubElement(
        par,
        f"{{{p_ns}}}cTn",
        {
            "id": str(next_id[0]),
            "presetID": preset_id,
            "presetClass": "entr",
            "presetSubtype": "0",
            "fill": "hold",
            "nodeType": node_type,
            "grpId": "0",
        },
    )
    next_id[0] += 1
    st = etree.SubElement(ctn, f"{{{p_ns}}}stCondLst")
    etree.SubElement(st, f"{{{p_ns}}}cond", {"delay": str(delay_ms)})
    kids = etree.SubElement(ctn, f"{{{p_ns}}}childTnLst")

    # Visibility set
    set_el = etree.SubElement(kids, f"{{{p_ns}}}set")
    cBhvr = etree.SubElement(set_el, f"{{{p_ns}}}cBhvr")
    cTn = etree.SubElement(cBhvr, f"{{{p_ns}}}cTn", {"id": str(next_id[0]), "dur": "1", "fill": "hold"})
    next_id[0] += 1
    st2 = etree.SubElement(cTn, f"{{{p_ns}}}stCondLst")
    etree.SubElement(st2, f"{{{p_ns}}}cond", {"delay": "0"})
    tgt = etree.SubElement(cBhvr, f"{{{p_ns}}}tgtEl")
    etree.SubElement(tgt, f"{{{p_ns}}}spTgt", {"spid": str(sid)})
    attr = etree.SubElement(cBhvr, f"{{{p_ns}}}attrNameLst")
    an = etree.SubElement(attr, f"{{{p_ns}}}attrName")
    an.text = "style.visibility"
    to = etree.SubElement(set_el, f"{{{p_ns}}}to")
    etree.SubElement(to, f"{{{a_ns}}}strVal", {"val": "visible"})

    # Visual filter
    anim = etree.SubElement(kids, f"{{{p_ns}}}animEffect", {"transition": "in", "filter": filter_name})
    cBhvr2 = etree.SubElement(anim, f"{{{p_ns}}}cBhvr")
    etree.SubElement(cBhvr2, f"{{{p_ns}}}cTn", {"id": str(next_id[0]), "dur": dur})
    next_id[0] += 1
    tgt2 = etree.SubElement(cBhvr2, f"{{{p_ns}}}tgtEl")
    etree.SubElement(tgt2, f"{{{p_ns}}}spTgt", {"spid": str(sid)})


def build_timing_xml(ids: list[int]) -> etree._Element:
    """Entrance animations: first shapes withEffect on load, rest clickEffect."""
    # Skip background picture (first shape id on our slides).
    anim_ids = ids[1:] if len(ids) > 1 else ids
    if not anim_ids:
        anim_ids = ids

    p_ns, a_ns = NSMAP["p"], NSMAP["a"]
    timing = etree.Element(f"{{{p_ns}}}timing")
    tn_lst = etree.SubElement(timing, f"{{{p_ns}}}tnLst")
    par0 = etree.SubElement(tn_lst, f"{{{p_ns}}}par")
    ctn0 = etree.SubElement(
        par0, f"{{{p_ns}}}cTn",
        {"id": "1", "dur": "indefinite", "restart": "never", "nodeType": "tmRoot"},
    )
    child0 = etree.SubElement(ctn0, f"{{{p_ns}}}childTnLst")
    seq = etree.SubElement(child0, f"{{{p_ns}}}seq", {"concurrent": "1", "nextAc": "seek"})
    ctn_seq = etree.SubElement(
        seq, f"{{{p_ns}}}cTn",
        {"id": "2", "dur": "indefinite", "nodeType": "mainSeq"},
    )
    child_seq = etree.SubElement(ctn_seq, f"{{{p_ns}}}childTnLst")
    next_id = [3]

    # Alternate filters for visual variety
    filters = [
        ("10", "fade", "550"),          # fade
        ("22", "wipe(down)", "650"),    # wipe
        ("2", "fade", "500"),           # appear-like via fade
        ("10", "fade", "600"),
    ]

    # First 3 content shapes cascade on slide open; remaining on click
    auto_count = min(3, len(anim_ids))

    for idx, sid in enumerate(anim_ids):
        preset_id, filt, dur = filters[idx % len(filters)]
        node_type = "withEffect" if idx < auto_count else "clickEffect"
        delay = 120 * idx if idx < auto_count else 0

        par_click = etree.SubElement(child_seq, f"{{{p_ns}}}par")
        ctn_click = etree.SubElement(par_click, f"{{{p_ns}}}cTn", {"id": str(next_id[0]), "fill": "hold"})
        next_id[0] += 1
        st_cond = etree.SubElement(ctn_click, f"{{{p_ns}}}stCondLst")
        if idx == 0:
            etree.SubElement(st_cond, f"{{{p_ns}}}cond", {"delay": "0"})
        elif idx < auto_count:
            etree.SubElement(st_cond, f"{{{p_ns}}}cond", {"delay": str(delay)})
        else:
            etree.SubElement(st_cond, f"{{{p_ns}}}cond", {"delay": "0"})

        child_click = etree.SubElement(ctn_click, f"{{{p_ns}}}childTnLst")
        par_inner = etree.SubElement(child_click, f"{{{p_ns}}}par")
        ctn_inner = etree.SubElement(par_inner, f"{{{p_ns}}}cTn", {"id": str(next_id[0]), "fill": "hold"})
        next_id[0] += 1
        st_inner = etree.SubElement(ctn_inner, f"{{{p_ns}}}stCondLst")
        etree.SubElement(st_inner, f"{{{p_ns}}}cond", {"delay": "0"})
        child_inner = etree.SubElement(ctn_inner, f"{{{p_ns}}}childTnLst")

        _add_entrance(child_inner, p_ns, a_ns, sid, next_id, 0, preset_id, filt, dur, node_type)

    prev = etree.SubElement(seq, f"{{{p_ns}}}prevCondLst")
    cond_p = etree.SubElement(prev, f"{{{p_ns}}}cond", {"evt": "onPrev", "delay": "0"})
    tgt_p = etree.SubElement(cond_p, f"{{{p_ns}}}tgtEl")
    etree.SubElement(tgt_p, f"{{{p_ns}}}sldTgt")
    nxt = etree.SubElement(seq, f"{{{p_ns}}}nextCondLst")
    cond_n = etree.SubElement(nxt, f"{{{p_ns}}}cond", {"evt": "onNext", "delay": "0"})
    tgt_n = etree.SubElement(cond_n, f"{{{p_ns}}}tgtEl")
    etree.SubElement(tgt_n, f"{{{p_ns}}}sldTgt")

    return timing


def inject_animations(pptx_path: Path):
    """Post-process: add timing XML + fade transition to every slide."""
    buf = io.BytesIO()
    with ZipFile(pptx_path, "r") as zin:
        files = {n: zin.read(n) for n in zin.namelist()}

    slide_names = sorted(
        [n for n in files if n.startswith("ppt/slides/slide") and n.endswith(".xml")],
        key=lambda s: int("".join(ch for ch in s if ch.isdigit()) or "0"),
    )

    p_ns = NSMAP["p"]
    for sname in slide_names:
        root = etree.fromstring(files[sname])
        ids = [int(el.get("id")) for el in root.xpath(".//p:cNvPr", namespaces=NSMAP) if el.get("id")]
        for t in root.xpath("./p:timing", namespaces=NSMAP):
            root.remove(t)
        for t in root.xpath("./p:transition", namespaces=NSMAP):
            root.remove(t)

        transition = etree.Element(f"{{{p_ns}}}transition", {"spd": "med", "advClick": "1"})
        etree.SubElement(transition, f"{{{p_ns}}}fade")
        root.append(transition)
        root.append(build_timing_xml(ids))

        files[sname] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    with ZipFile(buf, "w", ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)
    pptx_path.write_bytes(buf.getvalue())


def build():
    bg_main = make_background("bg_main", "main")
    bg_title = make_background("bg_title", "title")
    bg_qa = make_background("bg_qa", "qa")

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    blank = prs.slide_layouts[6]  # blank

    # ========== 1. Title ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_title)
    add_textbox(s, Inches(0.9), Inches(1.6), Inches(11.5), Inches(0.4),
                "FINAL YEAR PROJECT  ·  PROPOSAL PRESENTATION",
                size=13, color=GOLD, align=PP_ALIGN.CENTER, font="Calibri", bold=True)
    add_textbox(s, Inches(0.9), Inches(2.2), Inches(11.5), Inches(0.9),
                "AURELIA", size=54, color=GOLD_LIGHT, align=PP_ALIGN.CENTER, font="Georgia", bold=True)
    add_gold_bar(s, Inches(5.4), Inches(3.15), Inches(2.5))
    add_textbox(s, Inches(0.9), Inches(3.35), Inches(11.5), Inches(0.5),
                "Gold Marketplace Platform",
                size=24, color=CREAM, align=PP_ALIGN.CENTER, font="Georgia")
    add_textbox(s, Inches(0.9), Inches(3.95), Inches(11.5), Inches(0.4),
                "Buy, sell and auction gold with confidence",
                size=15, color=MUTED, align=PP_ALIGN.CENTER, font="Calibri")

    add_textbox(s, Inches(0.9), Inches(4.7), Inches(11.5), Inches(0.35),
                "Group Members (Registration No.)",
                size=14, color=GOLD, align=PP_ALIGN.CENTER, font="Calibri", bold=True)
    add_textbox(s, Inches(2.5), Inches(5.15), Inches(8.3), Inches(1.0),
                "_______________________________\n"
                "_______________________________\n"
                "_______________________________",
                size=14, color=CREAM, align=PP_ALIGN.CENTER, font="Calibri")
    add_footer(s, 1)

    # ========== 2. Problem Statement ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Problem Statement / Type of Work",
                    "Type of work: Cross-platform marketplace system (mobile + API)")
    add_card(s, Inches(0.7), Inches(1.85), Inches(12.0), Inches(1.55))
    add_textbox(s, Inches(0.95), Inches(2.05), Inches(11.5), Inches(1.2),
                "Buyers and sellers lack a unified, trust-oriented digital channel to list, "
                "price, verify, search, communicate about, and auction gold items with "
                "marketplace-specific attributes (purity, weight, hallmarks, certificates, and live/quoted rates).",
                size=16, color=CREAM, font="Calibri")

    add_card(s, Inches(0.7), Inches(3.65), Inches(5.8), Inches(2.9))
    add_textbox(s, Inches(0.95), Inches(3.85), Inches(5.3), Inches(0.4),
                "Why it matters", size=16, color=GOLD, bold=True, font="Georgia")
    add_bullets(s, Inches(0.95), Inches(4.3), Inches(5.3), Inches(2.0), [
        "Gold trading needs purity, weight & rate context",
        "Trust needs verification, stores & certificates",
        "Fragmented digital channels slow confident trades",
    ], size=14)

    add_card(s, Inches(6.8), Inches(3.65), Inches(5.9), Inches(2.9))
    add_textbox(s, Inches(7.05), Inches(3.85), Inches(5.4), Inches(0.4),
                "Our response — AURELIA", size=16, color=GOLD, bold=True, font="Georgia")
    add_bullets(s, Inches(7.05), Inches(4.3), Inches(5.4), Inches(2.0), [
        "Flutter client + Node.js modular API",
        "Gold listings, stores, rates & auctions",
        "Auth, KYC, chat, payments & moderation",
    ], size=14)
    add_footer(s, 2)

    # ========== 3. Literature / Background ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Literature Review / Background",
                    "Background from product domain · literature sources to be filled manually")
    add_card(s, Inches(0.7), Inches(1.85), Inches(12.0), Inches(2.2))
    add_textbox(s, Inches(0.95), Inches(2.05), Inches(11.5), Inches(0.35),
                "Domain background (known)", size=16, color=GOLD, bold=True)
    add_bullets(s, Inches(0.95), Inches(2.5), Inches(11.5), Inches(1.4), [
        "Gold is traded as bars, coins, jewellery, and investment metal.",
        "Usable marketplaces need listing, pricing (gram/tola/ounce, making charges), hallmarks/certificates, and buyer–seller communication.",
        "AURELIA centralizes these under one Gold Marketplace product surface.",
    ], size=14)

    add_card(s, Inches(0.7), Inches(4.25), Inches(12.0), Inches(2.3))
    add_textbox(s, Inches(0.95), Inches(4.45), Inches(11.5), Inches(0.35),
                "Related work / gap matrix (fill manually)", size=16, color=GOLD, bold=True)
    add_textbox(s, Inches(0.95), Inches(4.95), Inches(11.5), Inches(1.3),
                "Ref #1  _______________________________________________________________\n"
                "Ref #2  _______________________________________________________________\n"
                "Gap vs prior work  ____________________________________________________",
                size=14, color=MUTED, font="Calibri")
    add_footer(s, 3)

    # ========== 4. Business Scope ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Business Scope", "Stakeholders and boundaries confirmed in the current system")

    cards = [
        ("Buyers & Sellers", "Browse, buy, sell, and auction gold listings with structured attributes."),
        ("Gold Stores", "Business store applications and verified seller workflows."),
        ("Platform Ops", "Admin, moderation, support, risk, and analytics surfaces."),
    ]
    x = 0.7
    for title, body in cards:
        add_card(s, Inches(x), Inches(1.9), Inches(3.85), Inches(2.35))
        add_textbox(s, Inches(x + 0.25), Inches(2.15), Inches(3.35), Inches(0.4),
                    title, size=16, color=GOLD, bold=True)
        add_textbox(s, Inches(x + 0.25), Inches(2.7), Inches(3.35), Inches(1.3),
                    body, size=13, color=CREAM, font="Calibri")
        x += 4.05

    add_card(s, Inches(0.7), Inches(4.5), Inches(5.9), Inches(2.05))
    add_textbox(s, Inches(0.95), Inches(4.7), Inches(5.4), Inches(0.35),
                "In scope", size=15, color=GOLD, bold=True)
    add_bullets(s, Inches(0.95), Inches(5.1), Inches(5.4), Inches(1.3), [
        "Flutter AURELIA Gold Marketplace client",
        "Active gold API module + platform services",
        "Stores, rates, auctions, chat, payments, KYC",
    ], size=13, spacing=4)

    add_card(s, Inches(6.9), Inches(4.5), Inches(5.8), Inches(2.05))
    add_textbox(s, Inches(7.15), Inches(4.7), Inches(5.3), Inches(0.35),
                "Out of scope (today)", size=15, color=GOLD, bold=True)
    add_bullets(s, Inches(7.15), Inches(5.1), Inches(5.3), Inches(1.3), [
        "Property marketplace API (deactivated)",
        "Vehicles marketplace API (deactivated)",
        "Chemical assay / licensed AML claims",
    ], size=13, spacing=4)
    add_footer(s, 4)

    # ========== 5. Methodology / Framework ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Methodology / Framework",
                    "Logic flow of the study / system — architecture outline")

    layers = [
        ("1  Flutter Client", "AURELIA UI · routing · local DB · sockets"),
        ("2  Express API", "Modular monolith · JWT · Zod · /gold registry"),
        ("3  Data & Realtime", "MySQL · Redis cache · Socket.io rooms"),
        ("4  Providers", "AI adapters · payments · mailer"),
    ]
    y = 1.85
    for title, body in layers:
        add_card(s, Inches(1.5), Inches(y), Inches(10.3), Inches(0.95))
        add_textbox(s, Inches(1.8), Inches(y + 0.12), Inches(9.7), Inches(0.35),
                    title, size=16, color=GOLD, bold=True)
        add_textbox(s, Inches(1.8), Inches(y + 0.48), Inches(9.7), Inches(0.35),
                    body, size=13, color=CREAM, font="Calibri")
        y += 1.1

    add_textbox(s, Inches(0.7), Inches(6.35), Inches(12), Inches(0.4),
                "User → Client → API (/gold + platform) → MySQL/Redis/Sockets → Response / realtime events",
                size=13, color=MUTED, align=PP_ALIGN.CENTER, font="Calibri")
    add_footer(s, 5)

    # ========== 6. Tools and Languages ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Tools and Languages")

    tools = [
        ("Client", ["Flutter / Dart", "go_router, signals, dio", "Socket.io client", "Drift / SQLite", "flutter_map / geolocator"]),
        ("Backend", ["Node.js ≥ 20", "Express 5 + TypeScript", "Zod validation", "JWT auth", "Helmet / CORS / Pino"]),
        ("Data & Realtime", ["MySQL (marketplace DB)", "Redis (+ memory fallback)", "Socket.io rooms", "Migrations & seeds"]),
        ("Integrations", ["AI provider adapters", "Payment adapters", "Nodemailer", "Optional OpenAI-compatible"]),
    ]
    x = 0.55
    for title, items in tools:
        add_card(s, Inches(x), Inches(1.85), Inches(3.0), Inches(4.5))
        add_textbox(s, Inches(x + 0.2), Inches(2.1), Inches(2.6), Inches(0.4),
                    title, size=15, color=GOLD, bold=True)
        add_gold_bar(s, Inches(x + 0.2), Inches(2.55), Inches(1.4))
        add_bullets(s, Inches(x + 0.15), Inches(2.8), Inches(2.7), Inches(3.2), items, size=12, spacing=8)
        x += 3.2
    add_footer(s, 6)

    # ========== 7. Constraints ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Constraints and Limitation")

    items = [
        ("Payment gateways", "Unconfigured drivers fall back to manual settlement paths."),
        ("AI assistance", "Default provider is heuristic/offline; OpenAI-compatible is optional via config."),
        ("Authenticity helpers", "Gold authenticity helpers in code are not chemical assays."),
        ("Marketplace scope", "Property & Vehicles modules exist historically but are deactivated / out of active API scope."),
        ("Trust / AML", "AML and some trust features are partial or placeholder in places — document limits honestly."),
    ]
    y = 1.75
    for title, body in items:
        add_card(s, Inches(0.7), Inches(y), Inches(12.0), Inches(0.85))
        add_textbox(s, Inches(0.95), Inches(y + 0.1), Inches(11.5), Inches(0.3),
                    title, size=14, color=GOLD, bold=True)
        add_textbox(s, Inches(0.95), Inches(y + 0.42), Inches(11.5), Inches(0.35),
                    body, size=13, color=CREAM, font="Calibri")
        y += 0.95
    add_footer(s, 7)

    # ========== 8. Work breakdown ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Work Breakdown with Timelines",
                    "Packages from codebase · calendar dates left blank for manual entry")

    rows = [
        "Platform core — auth, users, verification, catalog",
        "Listings, auctions, search, maps, favorites / compare",
        "Chat, calls, notifications (Socket.io)",
        "Payments, subscriptions, ads, reviews",
        "AI, moderation, risk modules",
        "Gold marketplace module + Flutter gold / store flows",
        "Admin / seller / support dashboards",
    ]
    add_card(s, Inches(0.7), Inches(1.75), Inches(12.0), Inches(4.85))
    add_textbox(s, Inches(0.95), Inches(1.95), Inches(7.5), Inches(0.35),
                "Work package", size=13, color=GOLD, bold=True)
    add_textbox(s, Inches(8.6), Inches(1.95), Inches(1.6), Inches(0.35),
                "Start", size=13, color=GOLD, bold=True, align=PP_ALIGN.CENTER)
    add_textbox(s, Inches(10.4), Inches(1.95), Inches(1.8), Inches(0.35),
                "End", size=13, color=GOLD, bold=True, align=PP_ALIGN.CENTER)

    y = 2.4
    for row in rows:
        add_textbox(s, Inches(0.95), Inches(y), Inches(7.5), Inches(0.35),
                    f"•  {row}", size=13, color=CREAM, font="Calibri")
        add_textbox(s, Inches(8.6), Inches(y), Inches(1.6), Inches(0.35),
                    "____ / ____", size=12, color=MUTED, align=PP_ALIGN.CENTER, font="Calibri")
        add_textbox(s, Inches(10.4), Inches(y), Inches(1.8), Inches(0.35),
                    "____ / ____", size=12, color=MUTED, align=PP_ALIGN.CENTER, font="Calibri")
        y += 0.52
    add_footer(s, 8)

    # ========== 9. Conclusion ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Conclusion", "Expected outcomes of AURELIA (FYP–I)")

    outcomes = [
        ("End-to-end product", "Working Flutter client + modular API for gold commerce."),
        ("Gold-specific depth", "Stores, rates/quotes, purity, auctions, certificates & verification hooks."),
        ("Trust & ops", "Auth/KYC, chat, payments, moderation/risk, admin/seller/support."),
        ("Clear boundaries", "Active gold scope; deactivated Property/Vehicles left out unless restored."),
    ]
    y = 1.85
    for title, body in outcomes:
        add_card(s, Inches(1.2), Inches(y), Inches(10.9), Inches(1.05))
        add_textbox(s, Inches(1.5), Inches(y + 0.15), Inches(10.4), Inches(0.3),
                    title, size=15, color=GOLD, bold=True)
        add_textbox(s, Inches(1.5), Inches(y + 0.52), Inches(10.4), Inches(0.35),
                    body, size=13, color=CREAM, font="Calibri")
        y += 1.2
    add_footer(s, 9)

    # ========== 10. References ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "References", "Citation list not present in the repository — fill manually")
    add_card(s, Inches(0.7), Inches(1.85), Inches(12.0), Inches(4.7))
    refs = "\n\n".join([
        f"[ {i} ]  ___________________________________________________________________________"
        for i in range(1, 7)
    ])
    add_textbox(s, Inches(1.1), Inches(2.2), Inches(11.2), Inches(4.0),
                refs, size=15, color=MUTED, font="Calibri")
    add_footer(s, 10)

    # ========== 11. Key Features (spare slide filled with known product highlights) ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_main)
    add_title_block(s, "Key Product Capabilities", "Confirmed in the current AURELIA codebase")

    feats = [
        ("Auth & Security", "OTP, MFA, OAuth, passkeys, device security"),
        ("Gold Commerce", "Listings, purity/weight, rates, stores, hallmarks"),
        ("Auctions", "Bidding with realtime auction rooms"),
        ("Discovery", "Search, filters, maps, favorites, compare"),
        ("Communication", "Chat, calls, notifications (Socket.io)"),
        ("Trust & Ops", "KYC, reviews, ads, moderation, risk, admin"),
    ]
    positions = [
        (0.7, 1.85), (4.55, 1.85), (8.4, 1.85),
        (0.7, 4.15), (4.55, 4.15), (8.4, 4.15),
    ]
    for (title, body), (x, y) in zip(feats, positions):
        add_card(s, Inches(x), Inches(y), Inches(3.55), Inches(1.95))
        add_textbox(s, Inches(x + 0.25), Inches(y + 0.35), Inches(3.05), Inches(0.4),
                    title, size=15, color=GOLD, bold=True)
        add_textbox(s, Inches(x + 0.25), Inches(y + 0.9), Inches(3.05), Inches(0.8),
                    body, size=13, color=CREAM, font="Calibri")
    add_footer(s, 11)

    # ========== 12. Q/A ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, bg_qa)
    add_textbox(s, Inches(0.9), Inches(2.4), Inches(11.5), Inches(1.0),
                "Questions & Answers", size=44, color=GOLD_LIGHT, align=PP_ALIGN.CENTER,
                font="Georgia", bold=True)
    add_gold_bar(s, Inches(5.4), Inches(3.55), Inches(2.5))
    add_textbox(s, Inches(0.9), Inches(3.85), Inches(11.5), Inches(0.5),
                "Thank you", size=22, color=CREAM, align=PP_ALIGN.CENTER, font="Georgia")
    add_textbox(s, Inches(0.9), Inches(4.5), Inches(11.5), Inches(0.4),
                "AURELIA — Gold Marketplace Platform",
                size=14, color=MUTED, align=PP_ALIGN.CENTER, font="Calibri")
    add_footer(s, 12)

    prs.save(str(OUT))
    inject_animations(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
