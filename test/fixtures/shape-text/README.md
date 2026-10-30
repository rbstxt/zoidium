# Variable font fixtures

These OFL fixtures are independent test dependencies. They are not CM3 assets.
Each subset retains variable axes, layout tables, and the source font names.

- `RobotoFlex-subset.ttf`: Google Fonts Roboto Flex, TrueType `gvar`.
  Source: https://github.com/google/fonts/tree/main/ofl/robotoflex.
  License: `OFL-RobotoFlex.txt`.
- `SourceSerif-subset.otf`: Adobe Source Serif 4 Variable Roman, OpenType CFF2.
  Source: https://github.com/adobe-fonts/source-serif/tree/release/VAR.
  License: `OFL-SourceSerif.md`.

FontTools 4.64.0 generates both subsets with this command:

```sh
python3 -m fontTools.subset INPUT --text=' AVofficeáHello text200' --output-file=OUTPUT
```

SHA-256 of the checked-in subset files:

```text
c79d548be9fb97ae2e2f999e7c73671dca777e0b9b90a8506026c69d3b0b28c2  RobotoFlex-subset.ttf
be5adb46bc88b3ac38ea0b40831a6d63e0943c4e23137d8d6599561659dfd4d7  SourceSerif-subset.otf
```
