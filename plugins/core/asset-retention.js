(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  parts.createRetention = function (PZ, changed) {
    let editor = null, project = null, assets = null, alive = true;
    const held = new Set(), removing = new Set(), removed = new WeakSet(), patches = [];
    function retain(asset) {
      if (!alive || !assets || asset?.source !== PZ.asset.source.FILE || held.has(asset) || assets.list[asset.key] !== asset) return false;
      held.add(asset);
      assets.load(asset);
      changed();
      return true;
    }
    function release(asset) {
      if (!held.delete(asset)) return false;
      // Project replacement/disposal must not collect the old project's files.
      asset.references -= 1;
      changed();
      return true;
    }
    function projectChanged() {
      const next = editor?.project || null;
      if (project === next) return;
      assets?.onAssetCreated?.unwatch(retain);
      for (const asset of held) release(asset);
      project = next; assets = project?.assets || null;
      assets?.onAssetCreated?.watch(retain);
      for (const asset of Object.values(assets?.list || {})) retain(asset);
      changed();
    }
    function attach(next = global.CM) {
      if (!alive || !next) return;
      if (next !== editor) {
        editor?.onProjectChanged?.unwatch(projectChanged);
        editor = next;
        editor.onProjectChanged?.watch(projectChanged);
      }
      projectChanged();
    }
    function patch(target, key, wrap) {
      if (!target?.[key]) return;
      const previous = target[key], replacement = wrap(previous);
      target[key] = replacement;
      patches.push(() => { if (target[key] === replacement) target[key] = previous; });
    }
    // Install before native init creates the first editor project. Private
    // render projects never run editor.init and never receive a retention pin.
    patch(PZ.ui?.editor?.prototype, "init", original => function () {
      if (!global.CM || global.CM === this) attach(this);
      return original.apply(this, arguments);
    });
    patch(PZ.ui?.editor?.prototype, "assetRemoved", original => function (asset) {
      if (!removing.has(asset)) return original.apply(this, arguments);
    });
    patch(PZ.assetList?.prototype, "removeIfUnused", original => function (asset) {
      // A decoder cache can release its last hold after explicit deletion.
      // Never collect twice or delete a newer same-key import in that case.
      if (alive && removed.has(asset) && this.list[asset.key] !== asset) return;
      return original.apply(this, arguments);
    });
    patch(PZ.assetList?.prototype, "restore", original => function (asset) {
      if (alive && this === assets && asset.source === PZ.asset.source.FILE && asset.file && this.list[asset.key] !== asset) {
        asset.url = global.URL.createObjectURL(asset.file);
      }
      return original.apply(this, arguments);
    });
    global.addEventListener?.("zoidium:ready", attachReady);
    function attachReady() { attach(); }
    attach();
    return { retain, release, attach,
      remove(asset, list) {
        if (list.list[asset.key] !== asset) return;
        release(asset);
        removing.add(asset); removed.add(asset);
        try {
          if (asset.url) global.URL.revokeObjectURL(asset.url);
          delete list.list[asset.key];
          list.onAssetRemoved.update(asset);
        } finally { removing.delete(asset); }
      },
      has(asset, owner = global.CM?.project) { return project === owner && held.has(asset); },
      dispose() {
        alive = false;
        global.removeEventListener?.("zoidium:ready", attachReady);
        editor?.onProjectChanged?.unwatch(projectChanged);
        assets?.onAssetCreated?.unwatch(retain);
        for (const asset of held) release(asset);
        patches.reverse().forEach(restore => restore());
        editor = project = assets = null;
      },
    };
  };
})(globalThis);
