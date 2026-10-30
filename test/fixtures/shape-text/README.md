# Variable font fixtures

These OFL fixtures are independent test dependencies. They are not CM3 assets.
Each subset retains variable axes and layout tables. The CFF2 fixture uses
the family name Zoidium CFF2 Test to respect the source font's Reserved Font Name.

- `RobotoFlex-subset.ttf`: Google Fonts Roboto Flex, TrueType `gvar`.
  Source: https://github.com/google/fonts/tree/main/ofl/robotoflex.
  License: `OFL-RobotoFlex.txt`.
- `CFF2-test.otf`: Adobe Source Serif 4 Variable Roman, OpenType CFF2.
  Source: https://github.com/adobe-fonts/source-serif/tree/release/VAR.
  License: `OFL-SourceSerif.md`.

FontTools 4.64.0 generates both subsets with this command:

```sh
python3 -m fontTools.subset INPUT --text=' AVofficeáHello text200' --output-file=OUTPUT
```

SHA-256 of the checked-in subset files:

```text
c79d548be9fb97ae2e2f999e7c73671dca777e0b9b90a8506026c69d3b0b28c2  RobotoFlex-subset.ttf
223a81569d9283910132d572c9663d780f7bfb7ecc921a7e22669f80d69d883b  CFF2-test.otf
```

`NotoSansJP-subset.ttf` is an OFL Japanese fixture from
https://github.com/google/fonts/tree/main/ofl/notosansjp.
Its license is `OFL-NotoSansJP.txt`. FontTools 4.64.0 retains its variable weight
axis and subsets Japanese kana, kanji, punctuation, Latin letters, and digits.

After subsetting the CFF2 font, FontTools renames name IDs 1, 2, 3, 4, 6, 16,
17, 21, 22, and 25 to the Zoidium CFF2 Test family and its Regular style.
Copyright, license, and attribution records are preserved.
