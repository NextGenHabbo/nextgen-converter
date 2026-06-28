<div align="center">

# NextGen Converter

**Generate `.nitro` bundled assets for the Nitro client — modernised for Node.js 22+.**

[![Node](https://img.shields.io/badge/node-%3E%3D22.23.1-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)

</div>

---

## Overview

NextGen Converter bundles, extracts and converts Habbo assets (`.swf` → `.nitro`) for use with the Nitro client. It downloads furniture, figures, effects and pets, processes the game data files (furnidata, figuredata, productdata, external texts, etc.) and produces ready-to-serve `.nitro` bundles.

This is a fork of [billsonnn/nitro-converter](https://github.com/billsonnn/nitro-converter), refactored for modern Node.js and TypeScript.

## What's new in this fork

- **Node.js 22+ / modern TypeScript** — async/await throughout, modern `fs`/`path` APIs, no deprecated calls.
- **Human-readable timings** — finish messages now read `Finished build in 2h 5m 9s` instead of raw milliseconds.
- **Persistent logging** — every run mirrors all console output (and any subprocess stdout/stderr/exit code) to `logs/console.txt`, with stack traces and crash capture.

## Requirements

- **Node.js** `>= 22.23.1`
- **Yarn** (classic) — `npm i -g yarn`

## Installation

```bash
git clone https://github.com/NextGenHabbo/nextgen-converter.git
cd nextgen-converter
yarn install
yarn build
```

## Updating

```bash
git pull
yarn install   # only if dependencies changed
yarn build
```

Your `configuration.json` is git-ignored, so updates never overwrite it.

## Configuration

Copy `configuration.json.example` to `configuration.json`:

```bash
# Linux / macOS
cp configuration.json.example configuration.json
```

```powershell
# Windows (PowerShell)
Copy-Item configuration.json.example configuration.json
```

The simplest setup is to point `external.variables.url` at your external variables file — the converter pulls every URL from there when the matching key in the main config is `null` or `""`.

URLs may be a **local path** (recommended — much faster for downloads) or a remote URL.

| Key                            | Description                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| output.folder                  | Folder where converted assets are saved                                              |
| flash.client.url               | Base URL where figures/pets/effects are stored, e.g. `https://url/gordon/`            |
| furnidata.load.url             | URL to your furnidata (XML or JSON), e.g. `https://url/gamedata/furnidata.xml`        |
| productdata.load.url           | URL to your productdata.txt, e.g. `https://url/gamedata/productdata.txt`              |
| figuremap.load.url             | URL to your figure map (XML or JSON), e.g. `https://url/gordon/figuremap.xml`         |
| effectmap.load.url             | URL to your effect map (XML or JSON), e.g. `https://url/gordon/effectmap.xml`         |
| dynamic.download.pet.url       | Full URL where pets are stored, e.g. `https://url/gordon/%className%.swf`             |
| dynamic.download.figure.url    | Full URL where figures are stored, e.g. `https://url/gordon/%className%.swf`          |
| dynamic.download.effect.url    | Full URL where effects are stored, e.g. `https://url/gordon/%className%.swf`          |
| flash.dynamic.download.url     | Base URL where furniture is stored, e.g. `https://url/dcr/hof_furni/`                 |
| dynamic.download.furniture.url | Full URL where furniture is stored, e.g. `https://url/dcr/hof_furni/%className%.swf`  |
| external.variables.url         | URL to your external variables, e.g. `https://url/gamedata/external_variables.txt`    |
| external.texts.url             | URL to your external texts, e.g. `https://url/gamedata/external_texts.txt`            |
| convert.productdata            | `0` to skip, `1` to run                                                               |
| convert.externaltexts          | `0` to skip, `1` to run                                                               |
| convert.figure                 | `0` to skip, `1` to run                                                               |
| convert.figuredata             | `0` to skip, `1` to run                                                               |
| convert.effect                 | `0` to skip, `1` to run                                                               |
| convert.furniture              | `0` to skip, `1` to run                                                               |
| convert.pet                    | `0` to skip, `1` to run                                                               |

## Usage

> Run `yarn install && yarn build` once before first use.

Open a terminal in the converter directory and use one of:

| Command                  | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `yarn build`             | Runs `tsc` and builds `.js` from `.ts`                       |
| `yarn start`             | Downloads and converts assets per the config                |
| `yarn start:bundle`      | Bundles decompressed `.nitro` assets (json / png)           |
| `yarn start:extract`     | Extracts `.nitro` assets for editing                        |
| `yarn start:convert-swf` | Converts inputted `.swf` assets to `.nitro`                 |

The first run of `start:bundle | start:extract | start:convert-swf` auto-generates the folder structure for placing assets.

Existing assets are skipped, but XMLs are always re-converted and JSONs copied to the `gamedata` folder so your latest copy is always used.

## Logging

On startup the converter creates `logs/console.txt` (auto-created, recursive). It mirrors **everything** written to `stdout`/`stderr` — console logs, spinner status/success marks, errors and stack traces — to the file with timestamps, while leaving terminal output unchanged. ANSI colours are stripped and any subprocess output (stdout / stderr / exit code) is captured in a structured block. The `logs/` folder is git-ignored.

## Credits

Based on [nitro-converter](https://github.com/billsonnn/nitro-converter) by [billsonnn](https://github.com/billsonnn), GPLv3 licensed. Heavily modified and modernised.

## License

[GPL-3.0](LICENSE)
