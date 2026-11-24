<p align="center"><img src="atomo_celeste.png" width="128" alt="Celestial Atom icon"></p>

# Celestial Atom

*The deep sky in 3D, arranged in shells around the Earth like an atom* — original Italian name: «Atomo Celeste»

The Earth sits at the centre like the nucleus of an atom; galaxies, nebulae, clusters and stars sit around it on 8 concentric shells, like electrons. Each shell groups objects at a similar distance and the shells are close together, so you never fly for hours through empty space. Every object is in its true direction on the sky: seen from the Earth the sky is real, only the distances are compressed. It runs as a local web page (WebGL) served by a small Python program.

## Features

* Uses the database and photos of [Celestial Atlas](https://github.com/EDOKILLER/celestial-atlas) (create it first)
* Exact click selection, labels only where an object is really visible, information cards
* Arrow keys move you (forward/back, sideways); rotation with on-screen buttons and dragging; laptop-friendly buttons
* Correct at any screen scaling (125 %, 150 %…); executable with its own icon

> **Language note.** The interface is in **Italian** (large, adjustable text); plots, PDF/PNG cards and scientific output are in **English**. Code comments are in Italian. The original Italian guide is [`LEGGIMI.txt`](LEGGIMI.txt).

**Version:** 1.5 (2026-11-09). **Status:** 1.4 built and tested; 1.5 (arrow keys move instead of rotate) not yet built.

## Quick start

Requirements: Python 3.10+ (tested with Python 3.14 on Ubuntu) with `tkinter` (Ubuntu: `sudo apt install python3-tk`).

```bash
git clone https://github.com/EDOKILLER/celestial-atom.git
cd celestial-atom
python3 -m pip install -r requirements.txt

python3 atomo_celeste.py --autotest
python3 atomo_celeste.py        # opens the window
```

### Standalone executable

`bash crea_eseguibile_ubuntu.sh` builds a single-file executable with PyInstaller in a temporary virtual environment, runs the self-test, and adds the program with its icon to the application menu and the desktop (first time on GNOME: right-click → *Allow launching*). On Windows 11 install Python from python.org (tick *Add python.exe to PATH*) and double-click `crea_eseguibile_windows.bat`.

The build scripts were written for the author's machine: check the paths at the top before running them.

## Data sources and acknowledgements

Data are downloaded at run time from public services. If you publish results, please follow their acknowledgement policies:

* [Wikidata / Wikipedia](https://www.wikidata.org/)

This project is independent and not endorsed by any of these institutions.

## License

Code: [BSD 3-Clause](LICENSE) © 2026 Edoardo Battistel. You can use, modify and redistribute it, also commercially, as long as you keep the copyright notice; the author's name may not be used to promote derived works without permission. If you use it in research, see [`CITATION.cff`](CITATION.cff).

---
Part of a series of astronomy programs by Edoardo Battistel — see also [X-rays from Black Holes](https://github.com/EDOKILLER/x-rays-from-black-holes) and the other repositories on [this profile](https://github.com/EDOKILLER?tab=repositories).
