# Expressions+

Modern expressions and property links in CM3's native property panels. This
default-enabled plugin is part of Zoidium's external extension layer.

Alt-click a property's animation button to enter an expression. See the
[expression reference](../../docs/expressions.md) for syntax, navigation,
Sequence Controls, camera links and shader recipes.

The compiler uses Acorn 8.19.0 and astring 1.9.0. Their original CommonJS
distributions are bundled as text resources under `vendor/`, alongside their
MIT licenses. They are independent dependencies, not CM3 runtime resources.
Acorn comes from the already installed project dependency. astring is pinned
to `https://unpkg.com/astring@1.9.0/dist/astring.js`.
