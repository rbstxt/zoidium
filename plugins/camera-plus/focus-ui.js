// Camera+ — focus target menu + apply (extracted verbatim from the OpenZoid UI).
PZ.ui.controls.showFocusTargetMenu = function (button, property, mode) {
    let item = button.closest("li");
    let controls = item && item.parentElement ? item.parentElement.pz_controls : null;
    if (!controls) {
        return;
    }
    let editor = controls.editor;
    let camera = property.parentObject;
    let menu = document.createElement("ul");
    menu.classList.add("pz-dropdown");
    menu.setAttribute("tabindex", "-1");
    let count = 0;
    let header = document.createElement("li");
    header.style = "color:#999;pointer-events:none;";
    let headerText = document.createElement("span");
    headerText.innerText = "link" === mode ? "Link Focus Distance to..." : "Set Focus Distance to...";
    header.appendChild(headerText);
    menu.appendChild(header);
    editor.project.forEachItemOfType(PZ.object3d, function (object) {
        if (object === camera || object instanceof PZ.object3d.camera || !object.threeObj) {
            return;
        }
        let layer = object.tryGetParentOfType(PZ.layer);
        let row = document.createElement("li");
        let name = document.createElement("span");
        name.innerText = object.properties.name.get();
        row.appendChild(name);
        if (layer) {
            let layerName = document.createElement("span");
            layerName.innerText = layer.properties.name.get();
            layerName.style = "color:#999;margin-left:6px;";
            row.appendChild(layerName);
        }
        row.onclick = function () {
            menu.onblur = null;
            PZ.ui.controls.applyFocusTarget(controls, property, object, mode);
            menu.parentElement && menu.remove();
        };
        menu.appendChild(row);
        count++;
    });
    if (!count) {
        let empty = document.createElement("li");
        empty.style = "color:#999;pointer-events:none;";
        let emptyText = document.createElement("span");
        emptyText.innerText = "no 3D objects in project";
        empty.appendChild(emptyText);
        menu.appendChild(empty);
    }
    document.body.appendChild(menu);
    let rect = button.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = Math.max(0, rect.left) + "px";
    menu.style.top = Math.min(document.documentElement.clientHeight - menu.offsetHeight, rect.bottom + 2) + "px";
    menu.onblur = function () {
        this.onblur = null;
        this.parentElement && this.remove();
    };
    menu.focus();
};
PZ.ui.controls.applyFocusTarget = function (controls, property, target, mode) {
    let editor = controls.editor;
    let camera = property.parentObject;
    editor.history.startOperation();
    if ("link" === mode) {
        let source = "focusDistanceTo(object, " + JSON.stringify(target.getAddress()) + ")";
        controls.propertyOps.setExpression({ property: property.getAddress(), expression: source });
    } else {
        property.expression && controls.propertyOps.setExpression({ property: property.getAddress(), expression: null });
        let distance = PZ.expression.methods.focusDistanceTo(camera, target.getAddress());
        let frame = editor.playback.currentFrame - property.frameOffset;
        controls.propertyOps.setValue({ property: property.getAddress(), frame: frame, value: distance });
    }
    editor.history.finishOperation();
};
