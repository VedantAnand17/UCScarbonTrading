#!/usr/bin/env bash
# Fetch the Kaggle "Solar Power Generation Data" CSVs (Ani Kannal, 2020) into data/raw.
# Official source: https://www.kaggle.com/datasets/anikannal/solar-power-generation-data
# This script uses a public GitHub mirror and checks each file against the original SHA-256.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data/raw
base="https://media.githubusercontent.com/media/Pikanshi1/Wattora/HEAD/backend/data"
while read -r sha file; do
  [ -f "data/raw/$file" ] || curl -sfL -o "data/raw/$file" "$base/$file"
  echo "$sha  data/raw/$file" | sha256sum -c --quiet
done <<'SUMS'
7573be47df0bcd19d203e8ed1504faf0ab805ecb9a8fd44bb5de0d886c698750 Plant_1_Generation_Data.csv
91325041328745c288cb809aebd8b1b59cde54284500902ead1fb393499d6806 Plant_1_Weather_Sensor_Data.csv
9b735e9278774d4d1dd4601047315ef50b3793244d892446f6aabf4fae63bd37 Plant_2_Generation_Data.csv
cafd80885a51b88521b3301cffa4e4f013e2516fcb3478b439a81855edac3a64 Plant_2_Weather_Sensor_Data.csv
SUMS
echo "data ready"
