(function restoreVideoEditorControls(global) {
  "use strict";

  var editor = global.VE;
  var ui = global.PZ && global.PZ.ui;
  if (
    global.ZOIDIUM_LAYOUT !== "videoeditor" ||
    !editor ||
    !ui ||
    typeof editor.setUpEditor !== "function" ||
    typeof ui.toolbar !== "function" ||
    typeof ui.viewport !== "function" ||
    editor.__zoidiumControlsRestored
  ) {
    return;
  }

  var originalSetUpEditor = editor.setUpEditor;
  var originalToolbar = ui.toolbar;
  var originalViewport = ui.viewport;

  function copyToolbarStatics(toolbar) {
    Object.keys(originalToolbar).forEach(function (key) {
      toolbar[key] = originalToolbar[key];
    });
  }

  function isPlaybackToolbar(editorInstance, buttons) {
    return (
      editorInstance === editor &&
      Array.isArray(buttons) &&
      buttons.some(function (button) {
        return button && button.title === "start (home)";
      })
    );
  }

  function restoreButtons(buttons, viewport) {
    viewport.edit = true;
    editor.playback.loop = true;

    if (viewport.widget2d) {
      viewport.widget2d.edit = false;
    }

    var restored = buttons.map(function (button) {
      return button && typeof button === "object"
        ? Object.assign({}, button)
        : button;
    });
    var startIndex = restored.findIndex(function (button) {
      return button && button.title === "start (home)";
    });
    var loopButton = restored.find(function (button) {
      return button && button.title === "loop (ctrl-l)";
    });

    if (startIndex >= 0) {
      restored.splice(
        startIndex,
        0,
        {
          title: "editing camera (c)",
          icon: "camera",
          key: "c",
          observable: viewport.onEditChanged,
          update: function (button) {
            button.children[0].style.fill = viewport.edit
              ? "#8a2828"
              : "#acacac";
          },
          fn: function () {
            viewport.edit = !viewport.edit;
          },
        },
        {
          title: "layer transform controls (t)",
          icon: "transform",
          key: "t",
          observable: viewport.widget2d
            ? viewport.widget2d.onEditChanged
            : undefined,
          update: function (button) {
            var widget2d = viewport.widget2d;
            button.children[0].style.fill = widget2d && widget2d.edit
              ? "#8a2828"
              : "#acacac";
          },
          fn: function () {
            if (viewport.widget2d) {
              viewport.widget2d.edit = !viewport.widget2d.edit;
            }
          },
        },
        { separator: true }
      );
    }

    if (loopButton) {
      loopButton.icon = "loop";
      loopButton.observable = editor.playback.onLoopChanged;
      loopButton.update = function (button) {
        button.children[0].style.fill = this.editor.playback.loop
          ? "#8a2828"
          : "#acacac";
      };
    }

    if (!restored.some(function (button) {
      return button && button.title === "graph";
    })) {
      restored.push({
        title: "graph",
        key: "g",
        icon: "interp_1",
        modifierMask: originalToolbar.CTRL,
        fn: function () {
          var graphWindow = editor.createWindow({ title: "Graph editor" });
          graphWindow.setPanel(new ui.graphEditor(graphWindow.editor));
          graphWindow.enabled = true;
        },
      });
    }

    return restored;
  }

  editor.setUpEditor = function setUpEditorWithRestoredControls(account) {
    var viewport = null;

    function ViewportProxy(editorInstance, options) {
      var instance = new originalViewport(editorInstance, options);
      if (editorInstance === editor) viewport = instance;
      return instance;
    }

    function ToolbarProxy(editorInstance, buttons) {
      var restoredButtons = isPlaybackToolbar(editorInstance, buttons)
        ? restoreButtons(buttons, viewport)
        : buttons;
      return new originalToolbar(editorInstance, restoredButtons);
    }

    ViewportProxy.prototype = originalViewport.prototype;
    ToolbarProxy.prototype = originalToolbar.prototype;
    copyToolbarStatics(ToolbarProxy);
    ui.viewport = ViewportProxy;
    ui.toolbar = ToolbarProxy;

    try {
      return originalSetUpEditor.call(this, account);
    } finally {
      ui.viewport = originalViewport;
      ui.toolbar = originalToolbar;
    }
  };
  editor.__zoidiumControlsRestored = true;
})(window);
