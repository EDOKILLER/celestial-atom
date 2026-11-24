#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ATOMO CELESTE - gli oggetti del cielo in 3D, a gusci come un atomo
=================================================================
© 2026 Edoardo Battistel

La Terra al centro, come il nucleo; galassie, nebulose, ammassi e stelle
attorno, su gusci concentrici secondo la distanza (come gli elettroni).
Usa il database e le foto dell'Atlante Celeste.

Avvio:  AtomoCeleste (icona sulla Scrivania o nel menu, dopo crea_eseguibile_ubuntu.sh)
        python3 atomo_celeste.py                 apre la pagina 3D nel browser
        python3 atomo_celeste.py --prepara       rifà i dati (distanze, miniature)
        python3 atomo_celeste.py --atlante <cartella>   cartella dell'Atlante
        python3 atomo_celeste.py --autotest      prova senza rete
La prima volta prepara i dati (qualche minuto, serve Internet). Poi funziona
anche senza Internet. Per chiudere: Ctrl+C nel terminale (o chiudi la finestra).
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dati_atomo as D  # noqa: E402

NOME = "Atomo Celeste"
VERSIONE = "1.5"
COPYRIGHT = "© 2026 Edoardo Battistel"
FILE_CONFIG = Path.home() / ".atomo_celeste.json"
FILE_LISTA = Path.home() / ".lista_da_cercare_fits.json"      # condivisa con Atlante e Ricerca archivi
CARTELLA_PROGRAMMA = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
VERSIONE_THREE = "0.160.0"
FILE_THREE = {
    "three.module.js": f"https://cdn.jsdelivr.net/npm/three@{VERSIONE_THREE}/build/three.module.js",
    "OrbitControls.js": f"https://cdn.jsdelivr.net/npm/three@{VERSIONE_THREE}/examples/jsm/controls/OrbitControls.js",
}
PORTA = 8765


def ambiente_pulito():
    """Ambiente per i programmi esterni (browser, Ricerca archivi FITS).
    L'eseguibile di PyInstaller cambia LD_LIBRARY_PATH: il browser lanciato con quello
    può non partire. Si rimette il valore originale."""
    env = dict(os.environ)
    if getattr(sys, "frozen", False):
        for k in ("LD_LIBRARY_PATH", "LD_PRELOAD"):
            orig = env.pop(k + "_ORIG", None)
            if orig is not None:
                env[k] = orig
            else:
                env.pop(k, None)
    return env


def apri_browser(url):
    """Apre la pagina nel browser predefinito (con l'ambiente originale)."""
    if sys.platform.startswith("linux") and shutil.which("xdg-open"):
        try:
            subprocess.Popen(["xdg-open", url], env=ambiente_pulito(), start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            pass
    webbrowser.open(url)


def gia_aperto():
    """Se Atomo Celeste è già in funzione, restituisce l'indirizzo della sua pagina."""
    import urllib.request
    for porta in range(PORTA, PORTA + 20):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{porta}/api/info", timeout=0.5) as r:
                if json.loads(r.read()).get("nome") == NOME:
                    return f"http://127.0.0.1:{porta}/"
        except Exception:
            continue
    return None


def carica_json(p, predefinito):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return predefinito


def salva_json(p, d):
    tmp = Path(str(p) + ".tmp")
    tmp.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def cartella_atlante(cfg):
    """Stessa cartella usata dall'Atlante Celeste."""
    if cfg.get("atlante"):
        return Path(cfg["atlante"]).expanduser()
    a = carica_json(Path.home() / ".atlante_celeste.json", {})
    if a.get("cartella"):
        return Path(a["cartella"]).expanduser()
    r = carica_json(Path.home() / ".ricerca_archivi_fits.json", {})
    if r.get("cartella_dati"):
        return Path(r["cartella_dati"]).expanduser() / "Atlante_celeste"
    for n in ("Scrivania", "Desktop"):
        if (Path.home() / n / "Astronomia" / "Atlante_celeste").is_dir():
            return Path.home() / n / "Astronomia" / "Atlante_celeste"
    return Path.home() / "Atlante_celeste"


FILE_FACOLTATIVI = {   # se mancano la pagina funziona lo stesso
    "terra.jpg": f"https://cdn.jsdelivr.net/gh/mrdoob/three.js@r{VERSIONE_THREE.split('.')[1]}/examples/textures/planets/earth_atmos_2048.jpg",
}


def scarica_facoltativi(cartella_lib):
    for nome, url in FILE_FACOLTATIVI.items():
        p = cartella_lib / nome
        if p.exists() and p.stat().st_size > 1000:
            continue
        try:
            print(f"Scarico {nome}…", flush=True)
            p.write_bytes(D.scarica(url, timeout=120, tentativi=1))
        except Exception as e:
            print(f"   {nome} non scaricato ({type(e).__name__}): la pagina funziona lo stesso")


def scarica_three(cartella_lib):
    cartella_lib.mkdir(parents=True, exist_ok=True)
    for nome, url in FILE_THREE.items():
        p = cartella_lib / nome
        if p.exists() and p.stat().st_size > 1000:
            continue
        print(f"Scarico {nome}…", flush=True)
        dati = D.scarica(url, timeout=120)
        if nome == "OrbitControls.js":
            dati = dati.replace(b"from 'three'", b"from './three.module.js'").replace(
                b'from "three"', b"from './three.module.js'")
        p.write_bytes(dati)


# =============================================================================
# LISTA "DA CERCARE" E RICERCA ARCHIVI FITS
# =============================================================================
def leggi_lista():
    d = carica_json(FILE_LISTA, [])
    return [x for x in d if isinstance(x, dict) and x.get("nome")] if isinstance(d, list) else []


def commuta_lista(o):
    lista = leggi_lista()
    if any(x["nome"] == o["nome"] for x in lista):
        lista = [x for x in lista if x["nome"] != o["nome"]]
        dentro = False
    else:
        lista.append({"nome": o["nome"], "ra": round(float(o["ra"]), 6), "dec": round(float(o["dec"]), 6),
                      "tipo": o.get("tipo", ""), "aggiunto": datetime.now().strftime("%Y-%m-%d %H:%M")})
        dentro = True
    salva_json(FILE_LISTA, lista)
    return dentro


def comando_ricerca(o, cfg):
    arg = ["--oggetto", o["nome"], "--coordinate", f"{float(o['ra']):.6f} {float(o['dec']):+.6f}"]
    candidati = []
    for k in ("programma_ricerca",):
        if cfg.get(k):
            candidati.append(Path(cfg[k]))
    a = carica_json(Path.home() / ".atlante_celeste.json", {})
    if a.get("programma_ricerca"):
        candidati.append(Path(a["programma_ricerca"]))
    w = shutil.which("RicercaArchiviFITS")
    if w:
        candidati.append(Path(w))
    candidati += [Path.home() / ".local" / "bin" / "RicercaArchiviFITS",
                  Path(sys.executable).parent / "RicercaArchiviFITS.exe"]
    for c in candidati:
        if c.is_file():
            return ([sys.executable, str(c)] if c.suffix == ".py" else [str(c)]) + arg
    return None


# =============================================================================
# SERVER LOCALE
# =============================================================================
class Gestore(SimpleHTTPRequestHandler):
    atlante = Path(".")
    dati = Path(".")
    cfg = {}

    def log_message(self, *a):
        pass

    def _mappa(self, percorso):
        p = urllib.parse.unquote(urllib.parse.urlparse(percorso).path)
        if p in ("/", "/index.html"):
            return CARTELLA_PROGRAMMA / "web" / "index.html"
        if p.startswith("/foto/"):                       # prima la copia ritagliata, se c'è
            pulita = (self.dati / "foto_pulite" / p[len("/foto/"):]).resolve()
            if pulita.parent == (self.dati / "foto_pulite").resolve() and pulita.is_file():
                return pulita
        for pref, base in (("/web/", CARTELLA_PROGRAMMA / "web"), ("/lib/", self.dati / "lib"),
                           ("/dati/", self.dati), ("/foto/", self.atlante / "foto")):
            if p.startswith(pref):
                f = (base / p[len(pref):]).resolve()
                if base.resolve() in f.parents or f == base.resolve():
                    return f
        return None

    def translate_path(self, path):
        f = self._mappa(path)
        return str(f) if f else "/nonesiste"

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, d, codice=200):
        b = json.dumps(d, ensure_ascii=False).encode()
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/api/lista"):
            return self._json([x["nome"] for x in leggi_lista()])
        if self.path.startswith("/api/info"):
            return self._json({"nome": NOME, "versione": VERSIONE, "copyright": COPYRIGHT})
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            o = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json({"errore": "richiesta non valida"}, 400)
        if self.path.startswith("/api/lista"):
            try:
                return self._json({"dentro": commuta_lista(o)})
            except OSError as e:
                return self._json({"errore": str(e)}, 500)
        if self.path.startswith("/api/cerca"):
            cmd = comando_ricerca(o, self.cfg)
            if not cmd:
                return self._json({"errore": "Programma Ricerca archivi FITS non trovato. Indica il percorso "
                                             "nell'Atlante Celeste (Opzioni -> Programma Ricerca archivi FITS)."})
            try:
                subprocess.Popen(cmd, start_new_session=True, env=ambiente_pulito())
                return self._json({"ok": True})
            except OSError as e:
                return self._json({"errore": str(e)})
        return self._json({"errore": "sconosciuto"}, 404)


def avvia_server(atlante, dati, cfg):
    Gestore.atlante, Gestore.dati, Gestore.cfg = Path(atlante), Path(dati), cfg
    for porta in range(PORTA, PORTA + 20):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", porta), Gestore)
            return srv, porta
        except OSError:
            continue
    raise OSError("nessuna porta libera")


# =============================================================================
# PRINCIPALE
# =============================================================================
def barra(k, tot):
    print(f"\r   miniature {k}/{tot}   ", end="", flush=True)


def main():
    arg = sys.argv[1:]
    cfg = carica_json(FILE_CONFIG, {})
    if "--atlante" in arg:
        i = arg.index("--atlante")
        cfg["atlante"] = arg[i + 1]
        salva_json(FILE_CONFIG, cfg)
    atlante = cartella_atlante(cfg)
    print(f"{NOME} {VERSIONE}  —  {COPYRIGHT}")
    if "--prepara" not in arg:
        gia = gia_aperto()
        if gia:                       # già in funzione (per esempio doppio clic sull'icona due volte)
            print(f"Atomo Celeste è già aperto: riapro la pagina {gia}")
            if "--senza-browser" not in arg:
                apri_browser(gia)
            time.sleep(2)
            return
    print(f"Atlante Celeste: {atlante}")
    if not (atlante / "oggetti.sqlite").exists():
        print("\nNon trovo il database dell'Atlante Celeste (oggetti.sqlite).\n"
              "Indica la cartella con:  python3 atomo_celeste.py --atlante <cartella>")
        input("Premi Invio per chiudere…")
        return
    dati = atlante / "Atomo_celeste"
    vecchi = carica_json(dati / "dati.json", {}).get("versione", 0) < D.VERSIONE_DATI if (dati / "dati.json").exists() else True
    if "--prepara" in arg or vecchi:
        print("\nPreparo i dati (distanze, stelle, costellazioni, miniature): qualche minuto…\n")
        D.prepara(atlante, dati, riscarica="--wikidata" in arg, avanzamento=barra)
        print()
    try:
        scarica_three(dati / "lib")
    except Exception as e:
        print(f"\nNon riesco a scaricare Three.js ({type(e).__name__}): serve Internet solo la prima volta.")
        input("Premi Invio per chiudere…")
        return
    scarica_facoltativi(dati / "lib")
    srv, porta = avvia_server(atlante, dati, cfg)
    url = f"http://127.0.0.1:{porta}/"
    print(f"\nPagina 3D: {url}\n(Il browser si apre da solo. Per chiudere Atomo Celeste: Ctrl+C qui.)")
    if "--senza-browser" not in arg:
        threading.Timer(0.8, lambda: apri_browser(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nChiuso.")


def autotest():
    """Prova senza rete: dati finti, preparazione, server, API."""
    import sqlite3
    import tempfile
    import urllib.request
    ok = True

    def v(c, t):
        nonlocal ok
        print(("[ok] " if c else "[ERRORE] ") + t)
        ok &= bool(c)
    d = Path(tempfile.mkdtemp(prefix="atomo_"))
    con = sqlite3.connect(d / "oggetti.sqlite")
    con.execute("CREATE TABLE oggetti (id, nome, catalogo, altri_nomi, nomi_comuni, tipo_codice, gruppo, tipo, "
                "costellazione, ra, dec, dimensione, magnitudine, fonte_dati, importanza, fonte_foto, campo_foto)")
    righe = [("M31", "M 31", "Messier", "NGC 224", "Galassia di Andromeda", "G", "Galassie", "galassia",
              "And", 10.68, 41.27, 190, 3.4, "", 9, "", ""),
             ("NGC206", "NGC 206", "NGC", "", "", "OCl", "Ammassi aperti", "ammasso aperto", "And",
              10.15, 40.73, 4, 10, "", 2, "", ""),
             ("B33", "B 33", "Barnard", "", "Testa di Cavallo", "DrkN", "Nebulose oscure", "nebulosa oscura",
              "Ori", 85.25, -2.46, 6, None, "", 5, "", ""),
             ("NGC9999", "NGC 9999", "NGC", "", "", "G", "Galassie", "galassia", "Vir", 190.0, 10.0, 1, 14.0,
              "", 1, "", "")]
    con.executemany("INSERT INTO oggetti VALUES (" + ",".join("?" * 17) + ")", righe)
    con.commit()
    con.close()
    (d / "foto").mkdir()
    try:
        from PIL import Image
        Image.new("RGB", (800, 800), (40, 60, 120)).save(d / "foto" / "M31.jpg")
    except ImportError:
        pass
    (d / "distanze_wikidata.json").write_text(json.dumps({"M31": [2.5e6, "Wikidata", "distanza"]}))
    D.heasarc = lambda t: []                       # niente rete
    D.scarica = lambda *a, **k: (_ for _ in ()).throw(OSError("niente rete"))
    dati = D.prepara(d, d / "Atomo_celeste")
    og = {r[0]: r for r in dati["oggetti"]}
    v(og["M31"][9] == 2.5e6 and og["M31"][10] == 0, "distanza misurata (M 31)")
    v(og["NGC206"][10] == 1 and "Andromeda" in og["NGC206"][11], "ammasso dentro M 31: distanza della galassia")
    v(og["B33"][10] == 2 and 400 <= og["B33"][9] <= 1500, "nebulosa oscura: distanza stimata dal tipo")
    v(og["NGC9999"][10] == 2 and og["NGC9999"][9] > 5e6, "galassia senza distanza: stima dalla magnitudine")
    v(len(dati["stelle"]) >= 8, "stelle vicine aggiunte")
    v(len(dati["gusci"]) == 8, "8 gusci")
    global FILE_LISTA
    FILE_LISTA = d / "lista.json"
    srv, porta = avvia_server(d, d / "Atomo_celeste", {})
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{porta}"
    v(b"Atomo Celeste" in urllib.request.urlopen(base + "/").read(), "pagina servita")
    v(len(urllib.request.urlopen(base + "/dati/dati.json").read()) > 100, "dati serviti")
    v(urllib.request.urlopen(base + "/web/icona.png").read()[:4] == b"\x89PNG", "icona della pagina servita")
    js = urllib.request.urlopen(base + "/web/app.js").read().decode("utf-8")
    v("muoviFrecce" in js and "arrowleft" in js and "PageUp" in js, "frecce direzionali nella pagina")
    v(gia_aperto() is not None, "programma già aperto riconosciuto")
    req = urllib.request.Request(base + "/api/lista", data=json.dumps({"nome": "M 31", "ra": 10.68, "dec": 41.27}).encode(),
                                 method="POST")
    v(json.loads(urllib.request.urlopen(req).read())["dentro"] is True, "lista da cercare: aggiunto")
    v(json.loads(urllib.request.urlopen(base + "/api/lista").read()) == ["M 31"], "lista da cercare: letta")
    try:
        urllib.request.urlopen(base + "/dati/../../../etc/passwd")
        v(False, "file fuori dalle cartelle bloccati")
    except Exception:
        v(True, "file fuori dalle cartelle bloccati")
    srv.shutdown()
    print("AUTOTEST SUPERATO" if ok else "AUTOTEST FALLITO")
    return d if ok else None


if __name__ == "__main__":
    if "--autotest" in sys.argv:
        sys.exit(0 if autotest() else 1)
    main()
