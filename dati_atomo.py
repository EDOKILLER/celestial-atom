# -*- coding: utf-8 -*-
"""
ATOMO CELESTE - PREPARAZIONE DEI DATI
=====================================
© 2026 Edoardo Battistel

Legge il database dell'Atlante Celeste, trova le distanze (Wikidata, HEASARC),
stima quelle mancanti, aggiunge le stelle luminose e le linee delle
costellazioni, crea i fogli di miniature e scrive dati.json per la pagina 3D.
Solo libreria standard + Pillow (per le miniature; senza Pillow niente foto nel 3D).
"""

import csv
import hashlib
import io
import json
import math
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

VERSIONE_DATI = 2
UA = {"User-Agent": "AtomoCeleste/1.0 (amateur astronomy software)"}
URL_WIKIDATA = "https://query.wikidata.org/sparql"
URL_HEASARC = "https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync"
URL_COSTELLAZIONI = [
    "https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/{f}",
    "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/{f}",
]
C_KMS, H0 = 299792.458, 70.0
AL_PER_PC = 3.26156
CELLA, PER_LATO = 64, 32                 # miniature 64 px, fogli 2048 x 2048 (1024 oggetti)
_log = print


def imposta_log(f):
    global _log
    _log = f


def scarica(url, dati=None, timeout=180, tentativi=3):
    for k in range(tentativi):
        try:
            req = urllib.request.Request(url, data=dati, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as f:
                return f.read()
        except Exception as e:
            if k == tentativi - 1:
                raise
            _log(f"   (riprovo dopo {type(e).__name__})")
            time.sleep(10 * (k + 1))


# ----------------------------------------------------------------- Atlante
def leggi_atlante(cartella):
    con = sqlite3.connect(Path(cartella) / "oggetti.sqlite")
    con.row_factory = sqlite3.Row
    righe = [dict(r) for r in con.execute("SELECT id, nome, catalogo, altri_nomi, nomi_comuni, tipo_codice, gruppo, "
                                          "tipo, costellazione, ra, dec, dimensione, magnitudine, importanza, "
                                          "fonte_foto FROM oggetti")]
    con.close()
    return righe


def varianti(nome):
    """Possibili scritture del nome di catalogo su Wikidata."""
    nome = nome.strip()
    m = re.match(r"^(M|NGC|IC|Sh\s*2|Sh2|LDN|LBN|vdB|B|Barnard)\s*-?\s*(\d+[A-Za-z]?)$", nome, re.I)
    if not m:
        return {nome}
    pref, num = m.group(1), m.group(2)
    p = pref.replace(" ", "").lower()
    if p == "m":
        return {f"M {num}", f"M{num}", f"Messier {num}"}
    if p == "ngc":
        return {f"NGC {num}", f"NGC{num}"}
    if p == "ic":
        return {f"IC {num}", f"IC{num}"}
    if p == "sh2":
        return {f"Sh 2-{num}", f"Sh2-{num}", f"Sh 2-{num.zfill(3)}", f"Sh2-{num.zfill(3)}"}
    if p == "ldn":
        return {f"LDN {num}", f"L {num}"}
    if p == "lbn":
        return {f"LBN {num}"}
    if p == "vdb":
        return {f"vdB {num}", f"VdB {num}"}
    return {f"B {num}", f"Barnard {num}", f"B{num}"}


def nomi_oggetto(o):
    nomi = [o["nome"]] + [x.strip() for x in (o.get("altri_nomi") or "").split(",") if x.strip()]
    out = set()
    for n in nomi:
        out |= varianti(n)
    return out


# ----------------------------------------------------------------- Wikidata
def in_anni_luce(valore, unita):
    u = (unita or "").lower()
    if "megaparsec" in u:
        return valore * 1e6 * AL_PER_PC
    if "kiloparsec" in u:
        return valore * 1e3 * AL_PER_PC
    if "parsec" in u:
        return valore * AL_PER_PC
    if "light-year" in u or "light year" in u:
        if "million" in u or "mega" in u:
            return valore * 1e6
        if "kilo" in u or "thousand" in u:
            return valore * 1e3
        return valore
    return None


def wikidata(oggetti):
    codici = defaultdict(set)              # codice -> id degli oggetti
    for o in oggetti:
        for n in nomi_oggetto(o):
            codici[n].add(o["id"])
    elenco = sorted(codici)
    trovati = {}
    passo = 400
    _log(f"Wikidata: {len(elenco)} nomi da cercare, {math.ceil(len(elenco) / passo)} richieste")
    for i in range(0, len(elenco), passo):
        valori = " ".join(json.dumps(c) for c in elenco[i:i + passo])
        q = f"""SELECT ?code ?dist ?ul ?z WHERE {{
  VALUES ?code {{ {valori} }}
  ?item wdt:P528 ?code .
  OPTIONAL {{ ?item p:P2583/psv:P2583 ?dv . ?dv wikibase:quantityAmount ?dist ; wikibase:quantityUnit ?u .
             ?u rdfs:label ?ul FILTER(lang(?ul) = "en") }}
  OPTIONAL {{ ?item wdt:P1090 ?z }}
  FILTER(BOUND(?dist) || BOUND(?z))
}}"""
        try:
            dati = scarica(URL_WIKIDATA, urllib.parse.urlencode({"query": q, "format": "json"}).encode(), 120)
            ris = json.loads(dati)["results"]["bindings"]
        except Exception as e:
            _log(f"   richiesta {i // passo + 1}: errore {type(e).__name__}: {str(e)[:100]}")
            continue
        for r in ris:
            code = r["code"]["value"]
            al, metodo = None, ""
            if "dist" in r:
                al = in_anni_luce(float(r["dist"]["value"]), r.get("ul", {}).get("value"))
                metodo = "distanza"
            if al is None and "z" in r:
                z = float(r["z"]["value"])
                if 0 < z < 10:
                    al = z * C_KMS / H0 * 1e6 * AL_PER_PC
                    metodo = "redshift"
            if al and al > 0:
                for oid in codici.get(code, ()):
                    if oid not in trovati or (trovati[oid][2] == "redshift" and metodo == "distanza"):
                        trovati[oid] = (al, "Wikidata", metodo)
        print(f"   {min(i + passo, len(elenco))}/{len(elenco)} nomi, trovati finora {len(trovati)} oggetti", flush=True)
        time.sleep(1)
    return trovati


# ----------------------------------------------------------------- HEASARC
def heasarc(tabella):
    """Tabella intera da HEASARC: prova CSV, poi VOTable (testo), poi VOTable con astropy."""
    base = {"REQUEST": "doQuery", "LANG": "ADQL", "MAXREC": "300000", "QUERY": f"SELECT * FROM {tabella}"}
    prove = [dict(base, RESPONSEFORMAT="csv"), dict(base, FORMAT="csv"), dict(base, FORMAT="votable/td"), base]
    ultimo = b""
    for q in prove:
        dati = scarica(URL_HEASARC + "?" + urllib.parse.urlencode(q), timeout=300)
        ultimo = dati
        testa = dati.lstrip()[:2000]
        if testa[:5] == b"<?xml" or b"<VOTABLE" in testa:
            righe = leggi_votable(dati)
            if not righe and (b"<BINARY" in dati[:200000]):
                righe = votable_astropy(dati)
        else:
            righe = list(csv.DictReader(io.StringIO(dati.decode("utf-8", "replace"))))
        if righe:
            return righe
    inizio = ultimo[:600].decode("utf-8", "replace").replace("\n", " ")
    _log(f"   {tabella}: risposta non letta, inizio: {inizio}")
    return []


def votable_astropy(dati):
    try:
        from astropy.io.votable import parse_single_table
    except ImportError:
        _log("   (VOTable binaria: servirebbe astropy)")
        return []
    t = parse_single_table(io.BytesIO(dati)).to_table()
    return [{c: str(r[c]) for c in t.colnames} for r in t]


def leggi_votable(dati):
    """Legge una VOTable (formato TABLEDATA) con la sola libreria standard."""
    import xml.etree.ElementTree as ET
    campi, righe = [], []
    for ev, el in ET.iterparse(io.BytesIO(dati), events=("end",)):
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "FIELD":
            campi.append(el.get("name") or el.get("ID"))
        elif tag == "TR":
            valori = [(td.text or "").strip() for td in el if td.tag.rsplit("}", 1)[-1] == "TD"]
            righe.append(dict(zip(campi, valori)))
            el.clear()
    return righe


def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def colonna_distanza(colonne):
    """Sceglie la colonna con la distanza (o la velocità/redshift) e il fattore in anni luce."""
    low = {c.lower(): c for c in colonne}
    for nome, fattore in (("distance", None), ("dist", None), ("distance_sun", 1e3 * AL_PER_PC),
                          ("r_sun", 1e3 * AL_PER_PC), ("rsun", 1e3 * AL_PER_PC), ("d", AL_PER_PC)):
        if nome in low:
            return low[nome], fattore, "distanza"
    for c in colonne:
        if "dist" in c.lower() and "error" not in c.lower() and "flag" not in c.lower():
            return c, None, "distanza"
    for nome in ("velocity", "radial_velocity", "vel", "cz", "redshift", "z"):
        if nome in low:
            return low[nome], None, "velocità" if nome != "redshift" and nome != "z" else "redshift"
    return None, None, None


def griglia(punti):
    g = defaultdict(list)
    for p in punti:
        g[(int((p[1] + 90) // 1), int(p[0] // 1))].append(p)
    return g


def vicino(g, ra, dec, raggio_gradi):
    cella_dec = int((dec + 90) // 1)
    migliore, dmin = None, raggio_gradi
    cosd = max(0.01, math.cos(math.radians(dec)))
    lr = int(math.ceil(raggio_gradi / cosd))
    for dd in (-1, 0, 1):
        for dr in range(-lr - 1, lr + 2):
            for p in g.get((cella_dec + dd, int(ra // 1 + dr) % 360), ()):
                d = math.hypot((p[0] - ra + 180) % 360 - 180, 0) * cosd
                d = math.hypot(d, p[1] - dec)
                if d < dmin:
                    migliore, dmin = p, d
    return migliore




# =============================================================================
# DISTANZE
# =============================================================================
GUSCI = [  # limite superiore in anni luce, nome del guscio
    (100, "Stelle vicine"),
    (1_000, "Stelle e nebulose vicine"),
    (10_000, "Il nostro braccio della Via Lattea"),
    (100_000, "La Via Lattea"),
    (3_000_000, "Gruppo Locale"),
    (60_000_000, "Galassie vicine e ammasso della Vergine"),
    (300_000_000, "Galassie lontane"),
    (100_000_000_000, "Universo profondo"),
]

# tabelle HEASARC: colonna della distanza e fattore per avere anni luce
HEASARC_DISTANZE = [
    ("globclust", {"Ammassi globulari"}, 3.0, "helio_distance", 1e3 * AL_PER_PC),
    ("mwsc", {"Ammassi aperti", "Ammassi con nebulosa"}, 3.0, "distance", AL_PER_PC),
    ("openclust", {"Ammassi aperti", "Ammassi con nebulosa"}, 3.0, "distance", AL_PER_PC),
    ("zcat", {"Galassie"}, 1.0, "distance", 1e6 * AL_PER_PC),
]

# galassie che "ospitano" oggetti del catalogo (ammassi e nebulose al loro interno)
OSPITI = [  # nome, ra, dec, raggio in gradi, distanza in anni luce
    ("Grande Nube di Magellano", 80.894, -69.756, 5.5, 160_000),
    ("Piccola Nube di Magellano", 13.187, -72.829, 3.0, 200_000),
    ("Galassia di Andromeda (M 31)", 10.685, 41.269, 1.6, 2_500_000),
    ("Galassia del Triangolo (M 33)", 23.462, 30.660, 0.6, 2_730_000),
    ("Galassia nana del Sagittario", 283.764, -30.480, 4.0, 65_000),
    ("Galassia nana della Fornace", 39.997, -34.449, 0.7, 460_000),
]

# intervallo tipico (anni luce) per gli oggetti senza distanza misurata
TIPICI = {
    "DrkN": (400, 1_500), "RfN": (400, 1_500), "HII": (1_500, 8_000), "EmN": (1_500, 8_000),
    "Cl+N": (1_500, 8_000), "Neb": (1_000, 5_000), "Other": (1_000, 5_000), "SNR": (3_000, 15_000),
    "PN": (1_500, 8_000), "OCl": (1_000, 8_000), "*Ass": (1_000, 8_000), "GCl": (10_000, 60_000),
    "*": (100, 2_000), "**": (100, 2_000), "Nova": (1_000, 15_000),
}


def _caso(chiave):
    """Numero tra 0 e 1 sempre uguale per lo stesso oggetto."""
    return int(hashlib.md5(chiave.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def _log_unif(lo, hi, u):
    return 10 ** (math.log10(lo) + u * (math.log10(hi) - math.log10(lo)))


def distanze_heasarc(oggetti, trovati):
    for tabella, gruppi, raggio, colonna, fattore in HEASARC_DISTANZE:
        try:
            righe = heasarc(tabella)
        except Exception as e:
            _log(f"HEASARC {tabella}: non disponibile ({type(e).__name__})")
            continue
        punti = []
        for r in righe:
            ra, dec, v = num(r.get("ra")), num(r.get("dec")), num(r.get(colonna))
            if ra is None or dec is None:
                continue
            al = v * fattore if v and v > 0 else None
            if al is None and tabella == "zcat":
                vel = num(r.get("radial_velocity"))
                if vel and vel > 500:
                    al = vel / H0 * 1e6 * AL_PER_PC
            if al:
                punti.append((ra, dec, al))
        g = griglia(punti)
        n = 0
        for o in oggetti:
            if o["gruppo"] not in gruppi or o["ra"] is None or o["id"] in trovati:
                continue
            p = vicino(g, float(o["ra"]), float(o["dec"]), raggio / 60)
            if p:
                trovati[o["id"]] = (p[2], f"HEASARC {tabella}", "distanza")
                n += 1
        _log(f"HEASARC {tabella}: {n} oggetti con distanza")


def _sep(ra1, dec1, ra2, dec2):
    r = math.radians
    c = (math.sin(r(dec1)) * math.sin(r(dec2)) + math.cos(r(dec1)) * math.cos(r(dec2)) * math.cos(r(ra1 - ra2)))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def stima_mancanti(oggetti, trovati):
    """Per chi non ha distanza: galassia ospite, oppure distanza tipica del suo tipo."""
    ospiti = list(OSPITI)
    for o in oggetti:                                  # grandi galassie con distanza nota
        d = trovati.get(o["id"])
        if d and o["gruppo"] == "Galassie" and (o["dimensione"] or 0) >= 15 and d[0] < 5e7:
            ospiti.append((o["nome"], float(o["ra"]), float(o["dec"]), o["dimensione"] / 120, d[0]))
    stime = {}
    for o in oggetti:
        if o["id"] in trovati or o["ra"] is None:
            continue
        ra, dec = float(o["ra"]), float(o["dec"])
        if o["gruppo"] != "Galassie":
            for nome, ra0, dec0, rag, dist in ospiti:
                if abs(dec - dec0) < rag + 0.01 and _sep(ra, dec, ra0, dec0) < rag:
                    stime[o["id"]] = (dist, f"dentro {nome}", "ospite")
                    break
            if o["id"] in stime:
                continue
        u = _caso(o["id"])
        tipo = o.get("tipo_codice") or "Other"
        if tipo in TIPICI:
            al = _log_unif(*TIPICI[tipo], u)
        elif o["gruppo"] == "Galassie":
            m = o.get("magnitudine")
            if m:   # magnitudine assoluta tipica -20.5 (con dispersione)
                pc = 10 ** ((float(m) + 20.5 + (u - 0.5) * 2) / 5 + 1)
                al = min(max(pc * AL_PER_PC, 5e6), 1.5e9)
            else:
                al = _log_unif(5e7, 3e8, u)
        else:
            al = _log_unif(1_000, 5_000, u)
        stime[o["id"]] = (al, "stimata dal tipo di oggetto", "tipo")
    return stime


# =============================================================================
# STELLE E COSTELLAZIONI
# =============================================================================
NOMI_STELLE = {  # numero HR -> nome proprio
    2491: "Sirio", 2326: "Canopo", 5340: "Arturo", 5459: "Alfa Centauri", 7001: "Vega", 1708: "Capella",
    1713: "Rigel", 2943: "Procione", 472: "Achernar", 2061: "Betelgeuse", 5267: "Hadar", 7557: "Altair",
    4730: "Acrux", 1457: "Aldebaran", 6134: "Antares", 5056: "Spica", 2990: "Polluce", 8728: "Fomalhaut",
    7924: "Deneb", 4853: "Mimosa", 3982: "Regolo", 2618: "Adhara", 2891: "Castore", 6527: "Shaula",
    1790: "Bellatrix", 1791: "Elnath", 1903: "Alnilam", 1948: "Alnitak", 1852: "Mintaka", 2004: "Saiph",
    424: "Stella Polare", 5054: "Mizar", 4905: "Alioth", 4301: "Dubhe", 4295: "Merak", 5191: "Alkaid",
    1165: "Alcyone", 936: "Algol", 681: "Mira", 4534: "Denebola", 5793: "Alphecca", 6556: "Rasalhague",
    5563: "Kochab", 168: "Schedar", 21: "Caph", 337: "Mirach", 15: "Alpheratz", 617: "Hamal",
    7417: "Albireo", 7796: "Sadr", 6705: "Eltanin", 8308: "Enif", 8781: "Markab", 8775: "Scheat",
    3748: "Alphard", 509: "Tau Ceti", 1084: "Epsilon Eridani",
}
STELLE_VICINE = [  # stelle molto vicine troppo deboli per il catalogo delle stelle luminose
    ("Proxima Centauri", 217.4289, -62.6795, 4.24, 11.1), ("Stella di Barnard", 269.4521, 4.6934, 5.96, 9.5),
    ("Wolf 359", 164.1205, 7.0147, 7.86, 13.5), ("Lalande 21185", 165.8341, 35.9699, 8.31, 7.5),
    ("Luyten 726-8", 24.7600, -17.9500, 8.73, 12.5), ("Ross 154", 282.4557, -23.8362, 9.7, 10.4),
    ("Ross 248", 355.4797, 44.1774, 10.3, 12.3), ("Lacaille 9352", 346.4666, -35.8531, 10.7, 7.3),
]


def stelle_luminose(mag_max=5.5):
    try:
        righe = heasarc("bsc5p")
    except Exception as e:
        _log(f"Stelle luminose: catalogo non disponibile ({type(e).__name__})")
        righe = []
    stelle = []
    col_mag = "vmag"
    if righe and "vmag" not in righe[0]:
        col_mag = next((c for c in righe[0] if "vmag" in c.lower() or c.lower() in ("mag", "v_mag", "magnitude")), "vmag")
        _log(f"Stelle: colonna della magnitudine = {col_mag}")
    for r in righe:
        ra, dec = num(r.get("ra")), num(r.get("dec"))
        v = num(r.get(col_mag))
        if ra is None or dec is None or v is None:
            continue
        par = num(r.get("parallax")) or 0
        if v > mag_max and par < 0.03:
            continue
        hr = int(num(r.get("hr")) or 0)
        if par > 0.002:
            al, vera = AL_PER_PC / par, 1
        else:
            al, vera = _log_unif(300, 2_000, _caso(f"HR{hr}")), 0
        nome = NOMI_STELLE.get(hr) or re.sub(r"^\d+", "", (r.get("name") or "").strip()).strip() or f"HR {hr}"
        stelle.append([round(ra, 4), round(dec, 4), round(al, 1), round(v, 2), num(r.get("bv_color")) or 0.6,
                       nome, hr, vera])
    for nome, ra, dec, al, v in STELLE_VICINE:
        stelle.append([ra, dec, al, v, 1.5, nome, 0, 1])
    _log(f"Stelle: {len(stelle)}")
    return stelle


def costellazioni(stelle):
    """Linee delle costellazioni (d3-celestial) collegate alle stelle del catalogo."""
    linee = nomi = None
    for modello in URL_COSTELLAZIONI:
        try:
            linee = json.loads(scarica(modello.format(f="constellations.lines.json"), timeout=60))
            nomi = json.loads(scarica(modello.format(f="constellations.json"), timeout=60))
            break
        except Exception as e:
            _log(f"Costellazioni da {modello.split('/')[2]}: {type(e).__name__}")
    if not linee:
        return []
    nome_di = {}
    for f in (nomi or {}).get("features", []):
        p = f.get("properties", {})
        nome_di[f.get("id")] = p.get("name") or f.get("id")
    g = griglia([(s[0], s[1], i) for i, s in enumerate(stelle)])
    out = []
    for f in linee.get("features", []):
        segmenti = []
        for tratto in f.get("geometry", {}).get("coordinates", []):
            idx = []
            for lon, lat in tratto:
                p = vicino(g, lon % 360, lat, 0.4)
                idx.append(p[2] if p else None)
            for a, b in zip(idx, idx[1:]):
                if a is not None and b is not None and a != b:
                    segmenti.append([a, b])
        if segmenti:
            out.append({"id": f.get("id"), "nome": nome_di.get(f.get("id"), f.get("id")), "seg": segmenti})
    _log(f"Costellazioni: {len(out)}")
    return out


# =============================================================================
# MINIATURE (fogli 2048 x 2048 con 1024 foto da 64 px)
# =============================================================================
def ritaglio_valido(im):
    """Quadrato più grande, centrato sull'oggetto, senza zone bianche o nere prive di dati
    (bordi di Pan-STARRS, lacune della DSS). Restituisce (x0, y0, x1, y1), None se la foto
    è tutta buona, oppure "vuota" se resta troppo poco."""
    try:
        import numpy as np
    except ImportError:
        return None
    g = im.convert("L")
    w, h = g.size
    n = 50                                       # griglia di 50 x 50 blocchi sui pixel originali
    bw, bh = w // n, h // n
    if bw < 2 or bh < 2:
        return None
    a = np.asarray(g, dtype=np.float32)[:bh * n, :bw * n].reshape(n, bh, n, bw)
    media, dev = a.mean(axis=(1, 3)), a.std(axis=(1, 3))
    vuoto = (dev < 0.8) & ((media < 2.5) | (media > 249))      # uniforme e nero o bianco: niente dati
    if vuoto.mean() < 0.002:
        return None
    c = n // 2
    for meta in range(c, 7, -1):                 # quadrato centrato sempre più piccolo
        if vuoto[c - meta:c + meta, c - meta:c + meta].mean() <= 0.003:
            if meta == c:
                return None
            meta -= 1                                # un blocco di margine dal bordo vuoto
            return (int((c - meta) * bw), int((c - meta) * bh), int((c + meta) * bw), int((c + meta) * bh))
    return "vuota"                                # meno di un terzo del lato: inutilizzabile


def crea_fogli(oggetti, cartella_atlante, cartella_out, avanzamento=None):
    try:
        from PIL import Image
    except ImportError:
        _log("Pillow non installato: niente foto nel 3D (sudo apt install python3-pil)")
        return {}, 0
    cf = Path(cartella_atlante) / "foto"
    pulite = Path(cartella_out) / "foto_pulite"           # copie ritagliate per la scheda
    pulite.mkdir(parents=True, exist_ok=True)
    for vecchia in pulite.glob("*.jpg"):
        vecchia.unlink()
    con_foto = [o for o in oggetti if (cf / f"{o['id']}.jpg").exists()]
    con_foto.sort(key=lambda o: -(o.get("importanza") or 0))
    out = Path(cartella_out) / "fogli"
    out.mkdir(parents=True, exist_ok=True)
    for vecchio in out.glob("foglio_*.jpg"):
        vecchio.unlink()
    per_foglio = PER_LATO * PER_LATO
    posto = {}
    n_rit = n_vuote = 0
    buone = []
    for k, o in enumerate(con_foto):
        try:
            im = Image.open(cf / f"{o['id']}.jpg")
            im.load()
            im = im.convert("RGB")
        except Exception:
            continue
        r = ritaglio_valido(im)
        if r == "vuota":
            n_vuote += 1
            continue
        if r:
            im = im.crop(r)
            im.save(pulite / f"{o['id']}.jpg", quality=90)
            n_rit += 1
        buone.append((o, im.resize((CELLA, CELLA), Image.LANCZOS)))
        if avanzamento and k % 200 == 0:
            avanzamento(k, len(con_foto))
    n_fogli = math.ceil(len(buone) / per_foglio)
    for kf in range(n_fogli):
        foglio = Image.new("RGB", (CELLA * PER_LATO, CELLA * PER_LATO))
        for j, (o, mini) in enumerate(buone[kf * per_foglio:(kf + 1) * per_foglio]):
            foglio.paste(mini, ((j % PER_LATO) * CELLA, (j // PER_LATO) * CELLA))
            posto[o["id"]] = (kf, j)
        foglio.save(out / f"foglio_{kf}.jpg", quality=85)
    _log(f"Miniature: {len(posto)} foto in {n_fogli} fogli ({n_rit} ritagliate per togliere le zone "
         f"senza dati, {n_vuote} scartate perché quasi vuote)")
    return posto, n_fogli


# =============================================================================
# TUTTO INSIEME
# =============================================================================
def prepara(cartella_atlante, cartella_out, riscarica=False, avanzamento=None):
    cartella_atlante, cartella_out = Path(cartella_atlante), Path(cartella_out)
    cartella_out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    oggetti = [o for o in leggi_atlante(cartella_atlante) if o["ra"] is not None and o["dec"] is not None]
    _log(f"Oggetti dell'Atlante: {len(oggetti)}")
    trovati = {}
    cache = cartella_out / "distanze_wikidata.json"
    vecchia = cartella_atlante / "distanze_wikidata.json"        # dalla prova delle distanze
    for c in (cache, vecchia):
        if c.exists() and not riscarica:
            trovati.update({k: tuple(v) for k, v in json.loads(c.read_text(encoding="utf-8")).items()})
            _log(f"Wikidata: {len(trovati)} distanze già scaricate")
            break
    else:
        try:
            trovati.update(wikidata(oggetti))
            cache.write_text(json.dumps(trovati), encoding="utf-8")
        except Exception as e:
            _log(f"Wikidata non disponibile ({type(e).__name__})")
    distanze_heasarc(oggetti, trovati)
    stime = stima_mancanti(oggetti, trovati)
    stelle = stelle_luminose()
    cost = costellazioni(stelle)
    posto, n_fogli = crea_fogli(oggetti, cartella_atlante, cartella_out, avanzamento)
    righe = []
    for o in oggetti:
        if o["id"] in trovati:
            d, fonte, metodo = trovati[o["id"]]
            stato = 0
        else:
            d, fonte, metodo = stime[o["id"]]
            stato = 1 if metodo == "ospite" else 2
            if stato == 1:
                fonte = f"stimata: {fonte}"
        if metodo == "redshift":
            fonte += " (dal redshift)"
        f, c = posto.get(o["id"], (-1, -1))
        righe.append([o["id"], o["nome"], o.get("nomi_comuni") or "", o.get("altri_nomi") or "", o["gruppo"],
                      o["tipo"], o.get("costellazione") or "", round(float(o["ra"]), 5), round(float(o["dec"]), 5),
                      round(d, 1), stato, fonte, o.get("magnitudine"), o.get("dimensione"), f, c,
                      round(o.get("importanza") or 0, 2)])
    dati = {"versione": VERSIONE_DATI, "creato": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "gusci": GUSCI, "cella": CELLA, "per_lato": PER_LATO, "fogli": n_fogli,
            "campi": ["id", "nome", "nomi_comuni", "altri_nomi", "gruppo", "tipo", "costellazione", "ra", "dec",
                      "anni_luce", "stato", "fonte", "mag", "dim", "foglio", "cella", "importanza"],
            "oggetti": righe, "stelle": stelle, "costellazioni": cost}
    tmp = cartella_out / "dati.json.tmp"
    tmp.write_text(json.dumps(dati, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, cartella_out / "dati.json")
    n_vere = sum(1 for r in righe if r[10] == 0)
    _log(f"Pronto: {len(righe)} oggetti ({n_vere} con distanza misurata), {len(stelle)} stelle, "
         f"{len(cost)} costellazioni, in {(time.time() - t0) / 60:.1f} minuti")
    return dati
