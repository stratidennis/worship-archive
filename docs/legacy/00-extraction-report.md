# Extraction Report — SwiftTec Song Management System

## What was in `Song_Manager_Old/`

| File | Size | Notes |
|---|---|---|
| `Song Manager/SetupSongManager-latest.exe` | 42.6 MB | Inno Setup 5.5.6, **v1.0.41** |
| `Song Manager/KEY.txt` | 38 B | A SwiftTec licence key (redacted — this repo is public) |
| `Song Manager 2/SetupSongManager-romanian.exe` | 42.6 MB | **Byte-identical** to `-latest` (same MD5 `a2144ffe…`) |
| `Song Manager 2/SetupSongManager-english.exe` | 26.4 MB | Inno Setup 5.5.0, **v1.0.39** |
| `Song Manager 2/vc*redist*.exe` | — | Microsoft VC++ runtimes, irrelevant |

Product identity, from `app/product.bcf`:

```
PRODUCT_TITLE        SwiftTec Song Management System
PRODUCT_NAME         Song Management System
PRODUCT_VERSION      1.0.41
PRODUCT_DESCRIPTION  A program suite for handling a song database,
                     worship preparation and projection.
PRODUCT_COMPANY      SwiftTec          (Simon Sparkes)
PRODUCT_COPYRIGHT    © Copyright 2010-13 SwiftTec
PRODUCT_GUID         {1d7a4041-fdd3-4580-af94-55dd29c67308}
```

There is no Romanian build — the "romanian" installer is the same binary as "latest".
Language selection must have happened at install time or via a data folder.

## Important: source code does not exist in these files

**The original C++ source code cannot be recovered, and no amount of extraction will
produce it.** Every module is a compiled native Win32/x64 binary (Visual Studio 2015,
MFC/ATL). Compilation discards the source. The PDB paths left in the binaries point at
the original author's machine:

```
D:\Development\projects\InterProgramDiscovery\Release-x64\IPDSServer.pdb
D:\Development\CVS-Projects\include\swift\SWArray.cpp
```

Those files are on Simon Sparkes' development machine, not in the installer.

## What *was* recovered — and it is enough

Everything needed to specify a replacement was extracted:

| Artefact | Location | What it gives us |
|---|---|---|
| Full installer payload, both versions | `_extracted/v1_english/`, `_extracted/v2_latest/` | 17 executables, 14 DLLs, 143 UI images |
| Two nested sub-installers | `_extracted/nested_*/` | The Projector and the discovery service |
| Win32 resources (dialogs, menus, string tables, accelerators) | `_extracted/resources_v2.json` | The complete menu tree, every keyboard shortcut, every dialog's controls |
| ASCII + UTF-16 strings, all binaries | `_extracted/strings/` (raw), `_extracted/strings/clean/` (filtered) | Data model, XML schema, settings keys, CLI flags, log messages |
| UI assets | `_extracted/v2_latest/app/resources/` | 143 PNG icons + 15 cursors — a direct inventory of every feature that has a button |
| Localisable text | `app/resources/SongBase.ini`, `SongEditor.ini`, `Presenter.ini` | Every toolbar caption and prompt, in source form |

The reconstruction that follows is derived from these, and is stated as fact only where
a string, resource, or menu entry directly supports it. Anything inferred is marked.

## How to reproduce the extraction

```bash
docker build -t songextract - <<'EOF'
FROM debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq \
    innoextract p7zip-full binutils file unzip xxd python3 python3-pip icoutils \
 && pip3 install --break-system-packages pefile
EOF

docker run --rm -v "$PWD":/work -w /work songextract \
  innoextract -s -d _extracted/v2_latest "Song_Manager_Old/Song Manager/SetupSongManager-latest.exe"
```

The nested `SetupProjector-noredist-1.0.8.exe` and
`SetupInterProgramDiscovery-noredist-1.0.7.exe` inside `app/` are themselves Inno Setup
installers and need a second `innoextract` pass.

## Licensing note

The extracted binaries and assets are SwiftTec's copyrighted work. They are reference
material for understanding behaviour. The new application must be written from scratch:
no extracted asset, icon, or string should be copied into it. Feature parity is fine;
copying files is not.
