#!/usr/bin/env bash
# One-shot: copy NewCards/WizardCard_NNNNN.jpg into public/cards/
# with proper {rank}{suit}.jpg / Wizard.jpg / Jester.jpg / Back.jpg names.
# Idempotent (overwrites). Run from the wizard-multiplayer dir.
set -euo pipefail

SRC="../NewCards"
DST="public/cards"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  exit 1
fi
mkdir -p "$DST"

# index → target filename
declare -a MAP=(
  "Back"           # 00000
  "Wizard"         # 00001
  "QS" "QH" "QD" "QC"   # 00002–00005
  "KS" "KH" "KD" "KC"   # 00006–00009
  "JS" "JH"             # 00010, 00011
  "Jester"              # 00012
  "JD" "JC"             # 00013, 00014
  "AS" "AH" "AD" "AC"   # 00015–00018
  "10S" "10H" "10D" "10C"  # 00019–00022
  "9S" "9H" "9D" "9C"   # 00023–00026
  "8S" "8H" "8D" "8C"   # 00027–00030
  "7S" "7H" "7D" "7C"   # 00031–00034
  "6S" "6H" "6D" "6C"   # 00035–00038
  "5S" "5H" "5D" "5C"   # 00039–00042
  "4S" "4H" "4D" "4C"   # 00043–00046
  "3S" "3H" "3D" "3C"   # 00047–00050
  "2S" "2H" "2D" "2C"   # 00051–00054
  ""                    # 00055 (duplicate of 2C — skip)
)

for i in "${!MAP[@]}"; do
  name="${MAP[$i]}"
  if [[ -z "$name" ]]; then continue; fi
  src=$(printf "%s/WizardCard_%05d.jpg" "$SRC" "$i")
  dst="$DST/$name.jpg"
  if [[ ! -f "$src" ]]; then
    echo "Missing source: $src" >&2
    continue
  fi
  cp "$src" "$dst"
  echo "  $(basename "$src") -> $name.jpg"
done

echo "Done. $(ls "$DST" | wc -l | tr -d ' ') files in $DST."
