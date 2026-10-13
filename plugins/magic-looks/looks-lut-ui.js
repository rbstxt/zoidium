"use strict";

// Magic Looks — LUT tool panel (custom .cube import). Split from looks-setup.js
// to keep both files under the line limit. Builds the preset select, strength
// and gamma controls plus the Import/Clear row through the shared ZoidiumUI
// controls; all edits commit through the setup session so undo/redo works.

var Looks = Looks || {};

(function (Looks) {
  // Environment from the setup window: { Looks, ctl, effect, session, tool,
  // body, view, afterCommit, readProp, readNum, round, make }.
  function buildLut(env) {
    var Looks = env.Looks;
    var ctl = env.ctl;
    var effect = env.effect;
    var session = env.session;
    var view = env.view;
    var afterCommit = env.afterCommit;
    var readProp = env.readProp;
    var readNum = env.readNum;
    var round = env.round;
    var rec = Looks.tools.propMap().lut;
    var names = ["None", "Hot", "Cold", "Noir", Looks.cube.CUSTOM_NAME];
    var current = readProp(effect, rec.custom.lutName) || "None";
    if (names.indexOf(current) < 0) current = "None";

    var lutSelect = ctl.select({
      label: "LUT",
      value: current,
      options: names.map(function (n) { return { value: n, label: n }; }),
      onChange: function (v) {
        view.lutError = null;
        view.lutImportToken = (view.lutImportToken || 0) + 1;
        session.commit([{ key: rec.custom.lutName, value: v }]);
        afterCommit();
      },
    }).element;
    env.body.appendChild(lutSelect);

    env.body.appendChild(ctl.slider({
      label: "Strength",
      value: readNum(effect, rec.custom.lutStrength, 1),
      min: 0, max: 1, step: 0.01,
      onInput: function (v) { session.live(rec.custom.lutStrength, round(v)); },
      onChange: function (v) {
        session.commit([{ key: rec.custom.lutStrength, value: round(v) }]);
        afterCommit();
      },
    }).element);

    var gammaOptions = ["Same As Input", "Input", "Output"];
    env.body.appendChild(ctl.select({
      label: "LUT Gamma",
      value: String(Math.max(0, Math.round(readNum(effect, rec.custom.lutGamma, 0)))),
      options: gammaOptions.map(function (g, i) { return { value: String(i), label: g }; }),
      onChange: function (v) {
        session.commit([{ key: rec.custom.lutGamma, value: Number(v) || 0 }]);
        afterCommit();
      },
    }).element);

    var status;
    if (view.lutError) {
      status = view.lutError;
    } else if ((readProp(effect, rec.custom.lutName) || "None") === Looks.cube.CUSTOM_NAME) {
      var atlas = effect._looksCubeAtlas;
      status = atlas
        ? Looks.cube.describe(atlas)
        : effect._looksCubeError || "The stored LUT data could not be read. Import the .cube file again.";
    } else {
      status = readProp(effect, rec.custom.lutData)
        ? "Custom LUT stored in the project. Select Custom to apply it."
        : "No custom LUT imported.";
    }
    var statusNote = ctl.note(status).element;

    var picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".cube";
    picker.style.display = "none";
    picker.addEventListener("change", async function () {
      var file = picker.files && picker.files[0];
      if (!file) return;
      picker.value = "";
      var token = view.lutImportToken = (view.lutImportToken || 0) + 1;
      try {
        var key = await effect._looksLutAssets.importFile(file);
        if (token !== view.lutImportToken) return;
        view.lutError = null;
        session.commit([
          { key: rec.custom.lutName, value: Looks.cube.CUSTOM_NAME },
          { key: rec.custom.lutData, value: key },
        ]);
        await effect.prepare();
      } catch (err) {
        if (token !== view.lutImportToken) return;
        view.lutError = err && err.message ? err.message : "The file could not be imported.";
      }
      afterCommit();
    });
    env.body.appendChild(picker);

    var buttons = ctl.buttonRow([
      {
        title: "Import .cube...",
        hint: "Import a 3D .cube LUT (size 2..128); it is stored in the project",
        onClick: function () { picker.click(); },
      },
      {
        title: "Clear",
        hint: "Remove the imported LUT and return to no LUT",
        onClick: function () {
          view.lutImportToken = (view.lutImportToken || 0) + 1;
          view.lutError = null;
          session.commit([
            { key: rec.custom.lutName, value: "None" },
            { key: rec.custom.lutData, value: null },
          ]);
          afterCommit();
        },
      },
    ]).element;
    env.body.insertBefore(buttons, lutSelect.nextSibling || null);
    env.body.insertBefore(statusNote, buttons.nextSibling || null);
    env.body.appendChild(ctl.note("3D .cube LUTs (size 2..128) are stored in the project.").element);
  }

  Looks.lutUI = { buildLut: buildLut };
})(Looks);
