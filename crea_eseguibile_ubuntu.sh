#!/usr/bin/env bash
# =============================================================================
# Crea l'eseguibile "AtomoCeleste" per Ubuntu, con la sua icona sulla Scrivania
# e nel menu delle applicazioni.            © 2026 Edoardo Battistel
#
# Uso:  cd ~/Claude/Astropy/programma_atomo_celeste/versione_1.5
#       bash crea_eseguibile_ubuntu.sh
# =============================================================================
set -e
cd "$(dirname "$(readlink -f "$0")")"

for f in atomo_celeste.py dati_atomo.py web/index.html web/app.js web/icona.png atomo_celeste.png; do
    [ -f "$f" ] || { echo "ERRORE: manca $f in questa cartella ($(pwd))."; exit 1; }
done

echo "=== 1/4  Ambiente Python per la compilazione ==="
VENV="$HOME/Claude/Astropy/venv_compila"
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import PyInstaller" 2>/dev/null; then
    PY="$VENV/bin/python"
    echo "Uso l'ambiente già pronto: $VENV"
else
    echo "Ambiente $VENV non trovato: ne creo uno temporaneo (serve Internet)."
    [ -d .venv-build ] || python3 -m venv --system-site-packages .venv-build
    .venv-build/bin/python -m pip install --upgrade pip pyinstaller
    PY="$(pwd)/.venv-build/bin/python"
fi
"$PY" -c "import PIL, numpy" 2>/dev/null || {
    echo "Mancano Pillow o numpy: sudo apt install python3-pil python3-numpy"; exit 1; }

echo "=== 2/4  Creazione dell'eseguibile (un minuto circa) ==="
"$PY" -m PyInstaller --noconfirm --clean --onefile --console \
    --name AtomoCeleste \
    --add-data "web:web" \
    --hidden-import dati_atomo \
    --hidden-import PIL.Image \
    --hidden-import numpy \
    --exclude-module astropy \
    --exclude-module matplotlib \
    --exclude-module scipy \
    --exclude-module tkinter \
    atomo_celeste.py

echo "=== 3/4  Verifica dell'eseguibile (autotest, senza rete) ==="
if ! ./dist/AtomoCeleste --autotest > autotest.txt 2>&1; then
    cat autotest.txt
    echo
    echo "L'autotest è FALLITO: i dettagli sono in $(pwd)/autotest.txt"
    echo "L'eseguibile non è stato installato. Invia autotest.txt per la correzione."
    rm -rf build AtomoCeleste.spec
    exit 1
fi
grep -E "^\[(ok|ERRORE)\]|AUTOTEST" autotest.txt

echo "=== 4/4  Installazione, icona nel menu e sulla Scrivania ==="
DEST="$HOME/.local/bin"
ICONE="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$DEST" "$HOME/.local/share/applications" "$ICONE"
cp atomo_celeste.png "$ICONE/atomo-celeste.png"
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
cp dist/AtomoCeleste "$DEST/AtomoCeleste"
chmod +x "$DEST/AtomoCeleste"

# Terminal=true: si apre una finestra del terminale con i messaggi (la prima volta
# mostra la preparazione dei dati). Chiudendo quella finestra si chiude Atomo Celeste.
cat > "$HOME/.local/share/applications/atomo-celeste.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Atomo Celeste
Comment=Il cielo profondo in 3D a gusci, con la Terra al centro - © 2026 Edoardo Battistel
Exec=$DEST/AtomoCeleste
Icon=$ICONE/atomo-celeste.png
Terminal=true
Categories=Science;Astronomy;Education;
Keywords=atomo;cielo;3D;galassie;nebulose;stelle;
EOF
chmod +x "$HOME/.local/share/applications/atomo-celeste.desktop"
update-desktop-database -q "$HOME/.local/share/applications" 2>/dev/null || true

SCRIVANIA="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Scrivania")"
if [ -d "$SCRIVANIA" ]; then
    cp "$HOME/.local/share/applications/atomo-celeste.desktop" "$SCRIVANIA/"
    chmod +x "$SCRIVANIA/atomo-celeste.desktop"
    gio set "$SCRIVANIA/atomo-celeste.desktop" metadata::trusted true 2>/dev/null || true
fi

rm -rf build AtomoCeleste.spec .venv-build

echo
echo "FATTO."
echo "  Eseguibile:  $DEST/AtomoCeleste   (copia anche in $(pwd)/dist/)"
echo "  Avvio:       cerca 'Atomo Celeste' nel menu delle applicazioni,"
echo "               oppure doppio clic sull'icona sulla Scrivania"
echo "               (la prima volta: tasto destro -> 'Consenti avvio')."
echo "  Per chiudere: chiudi la finestra del terminale che si apre insieme alla pagina."
