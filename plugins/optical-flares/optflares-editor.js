// OpenZoid Optical Flares — Options window (ported from optflares-editor.js,
// SaaS-themed in v2: Inter type, silk-gradient backdrop, pill controls).
// Entry point PZ.opticalflares.open(root, designer); Object-panel gear wiring
// arrives with the designer/UI phase.
/*
 * optflares-editor.js
 *
 * The "Optical Flares Options" window: Preview, Stack, Editor and Browser
 * panels, matching the layout of the Video Copilot Optical Flares editor.
 * Opened from the Object panel gear button through designer.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var ELEMENT_TYPES = PZ.object3d.optflares.ELEMENT_TYPES;
    var MAX_PREVIEW_BRIGHTNESS = 400;

    var CSS = [
        ".of-window{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1200;display:flex;flex-direction:column;background:radial-gradient(900px 480px at 88% -6%,rgba(74,144,217,.16),transparent 60%),radial-gradient(760px 520px at 4% 108%,rgba(150,140,255,.10),transparent 62%),linear-gradient(180deg,#101014 0%,#0a0b0e 55%,#060708 100%);color:#e2e4e8;font-family:Inter,'Segoe UI',system-ui,-apple-system,sans-serif;font-size:12px;animation:ofFade .28s ease;}",
        ".of-window button{font-family:inherit;}",
        "@keyframes ofFade{from{opacity:0;}to{opacity:1;}}",
        "@keyframes ofRise{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}",
        ".of-titlebar{flex:0 0 46px;display:flex;align-items:center;gap:6px;background:rgba(14,16,20,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08);padding:0 10px;}",
        ".of-menu{position:relative;}",
        ".of-menu>button{background:transparent;border:0;color:#cfd3d9;font-size:11px;font-weight:500;letter-spacing:1px;height:100%;padding:8px 12px;cursor:pointer;border-radius:999px;transition:background .15s ease,color .15s ease;}",
        ".of-menu>button:hover{background:rgba(74,144,217,.18);color:#fff;}",
        ".of-dropdown{position:absolute;top:34px;left:0;min-width:170px;background:rgba(24,26,32,.97);border:1px solid rgba(255,255,255,.10);border-radius:12px;z-index:50;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.55);animation:ofRise .16s ease;}",
        ".of-dropdown.hidden{display:none;}",
        ".of-dropdown div{padding:7px 12px;cursor:pointer;color:#cfd3d9;white-space:nowrap;border-radius:8px;font-weight:500;}",
        ".of-dropdown div:hover{background:rgba(74,144,217,.25);color:#fff;}",
        ".of-title{flex:1;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:2px;font-weight:600;font-size:12px;color:#cfe0f2;}",
        ".of-title:before{content:'';width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#9cc4ee,#4a90d9);box-shadow:0 0 12px rgba(74,144,217,.8);flex:0 0 auto;}",
        ".of-paneltoggles{display:flex;align-items:center;gap:6px;color:#9aa0a8;font-size:11px;padding-right:8px;}",
        ".of-paneltoggles button{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#cfd3d9;font-size:10px;font-weight:600;padding:6px 12px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease;}",
        ".of-paneltoggles button:hover{color:#fff;border-color:rgba(74,144,217,.5);}",
        ".of-paneltoggles button.active{background:#4a90d9;color:#fff;border-color:#4a90d9;box-shadow:0 4px 14px rgba(74,144,217,.4);}",
        ".of-paneltoggles button:focus-visible,.of-bigbtn:focus-visible,.of-mini:focus-visible,.of-block:focus-visible{outline:2px solid #4a90d9;outline-offset:2px;}",
        ".of-bigbtn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8e9eb;font-size:11px;font-weight:600;letter-spacing:1px;padding:8px 20px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,transform .15s ease;}",
        ".of-bigbtn:hover{background:rgba(74,144,217,.2);border-color:rgba(74,144,217,.55);transform:translateY(-1px);}",
        ".of-bigbtn.primary{background:#4a90d9;border-color:#4a90d9;color:#fff;box-shadow:0 4px 16px rgba(74,144,217,.45);}",
        ".of-bigbtn.primary:hover{background:#5b9de0;}",
        ".of-body{flex:1;display:flex;min-height:0;gap:10px;padding:10px;box-sizing:border-box;}",
        ".of-col{display:flex;flex-direction:column;min-width:0;gap:10px;}",
        ".of-col-left{flex:1 1 58%;}",
        ".of-col-right{flex:1 1 42%;}",
        ".of-panel{display:flex;flex-direction:column;min-height:0;background:rgba(20,22,27,.88);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.45);animation:ofRise .34s ease;}",
        ".of-panel.hidden{display:none;}",
        ".of-panel-title{flex:0 0 32px;display:flex;align-items:center;gap:8px;padding:0 12px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.07);color:#cfe0f2;letter-spacing:2px;font-size:10px;font-weight:700;text-transform:uppercase;}",
        ".of-panel-title .of-spacer{flex:1;}",
        ".of-panel-title button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cfd3d9;font-size:10px;font-weight:600;padding:4px 12px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease;}",
        ".of-panel-title button:hover{background:rgba(74,144,217,.2);border-color:rgba(74,144,217,.5);color:#fff;}",
        ".of-preview{flex:1 1 auto;}",
        ".of-screen{flex:1;position:relative;min-height:120px;background:#000;overflow:hidden;}",
        ".of-screen.checker{background:linear-gradient(45deg,#222 25%,transparent 25%,transparent 75%,#222 75%),linear-gradient(45deg,#222 25%,#111 25%,#111 75%,#222 75%);background-size:16px 16px;background-position:0 0,8px 8px;}",
        ".of-screen .editorpanel{position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border:0!important;background:transparent!important;}",
        ".of-guides{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:none;}",
        ".of-guides.on{display:block;}",
        ".of-guides:before{content:'';position:absolute;left:33.3%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.25);box-shadow:0 0 0 1px rgba(0,0,0,.3);}",
        ".of-guides:after{content:'';position:absolute;left:66.6%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.25);box-shadow:0 0 0 1px rgba(0,0,0,.3);}",
        ".of-guides span{position:absolute;left:0;right:0;top:33.3%;height:1px;background:rgba(255,255,255,.25);box-shadow:0 0 0 1px rgba(0,0,0,.3);}",
        ".of-guides span+span{top:66.6%;}",
        ".of-preview-controls{flex:0 0 auto;display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:8px 12px;background:rgba(16,18,22,.9);border-top:1px solid rgba(255,255,255,.07);color:#9aa0a8;font-size:10px;font-weight:500;}",
        ".of-preview-controls label{display:flex;align-items:center;gap:6px;}",
        ".of-preview-controls input[type=number]{width:56px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:#e8e9eb;font-family:inherit;font-size:10px;padding:4px 6px;}",
        ".of-preview-controls input[type=number]:focus{border-color:#4a90d9;outline:none;}",
        ".of-preview-controls input[type=checkbox]{accent-color:#4a90d9;}",
        ".of-transport{display:flex;align-items:center;gap:6px;margin-left:auto;}",
        ".of-transport button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8e9eb;font-size:10px;font-weight:600;padding:5px 11px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease;}",
        ".of-transport button:hover{background:rgba(74,144,217,.2);border-color:rgba(74,144,217,.5);}",
        ".of-time{color:#9cc4ee;font-variant-numeric:tabular-nums;font-weight:600;min-width:34px;text-align:right;}",
        ".of-stack{flex:1 1 45%;}",
        ".of-stack-list{flex:1;overflow-y:auto;padding:8px;}",
        ".of-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid transparent;border-radius:10px;cursor:pointer;min-height:38px;box-sizing:border-box;transition:background .15s ease,border-color .15s ease;}",
        ".of-row:hover{background:rgba(255,255,255,.045);}",
        ".of-row.active{background:rgba(74,144,217,.22);border-color:#4a90d9;box-shadow:0 0 0 1px #4a90d9;}",
        ".of-row.of-global{border-style:dashed;border-color:rgba(74,144,217,.4);}",
        ".of-row.disabled .of-row-name,.of-row.disabled canvas{opacity:.4;}",
        ".of-row.dragover{border-top-color:#4a90d9;}",
        ".of-row canvas{width:44px;height:28px;background:#0a0a0a;border:1px solid rgba(255,255,255,.14);border-radius:6px;}",
        ".of-row-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}",
        ".of-row input[type=number]{width:58px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:#e8e9eb;font-family:inherit;font-size:10px;padding:4px 6px;}",
        ".of-row input[type=number]:focus{border-color:#4a90d9;outline:none;}",
        ".of-row-actions{display:flex;gap:4px;align-items:center;}",
        ".of-mini{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cfd3d9;font-size:9px;font-weight:700;letter-spacing:.5px;padding:4px 9px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease;}",
        ".of-mini:hover{background:rgba(74,144,217,.2);border-color:rgba(74,144,217,.5);color:#fff;}",
        ".of-mini.on{background:#4a90d9;border-color:#4a90d9;color:#fff;}",
        ".of-mini.x{color:#e89a9a;}",
        ".of-mini.x:hover{background:rgba(217,138,138,.16);border-color:rgba(217,138,138,.5);color:#fff;}",
        ".of-color{width:28px;height:20px;border:1px solid rgba(255,255,255,.25);border-radius:7px;cursor:pointer;padding:0;background:none;}",
        ".of-editor{flex:1 1 55%;}",
        ".of-blocks{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.07);}",
        ".of-block{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#cfd3d9;font-size:10px;font-weight:600;padding:6px 13px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease;}",
        ".of-block:hover{color:#fff;border-color:rgba(74,144,217,.5);transform:translateY(-1px);}",
        ".of-block.active{background:#4a90d9;border-color:#4a90d9;color:#fff;box-shadow:0 4px 14px rgba(74,144,217,.4);}",
        ".of-params{flex:1;overflow-y:auto;padding:4px 2px;}",
        ".of-params .editorpanel{border:0!important;background:transparent!important;height:auto!important;}",
        ".of-browser{flex:1 1 45%;}",
        ".of-browser-tabs{flex:0 0 auto;display:flex;gap:4px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.07);padding:6px 8px 0;}",
        ".of-browser-tab{flex:1;text-align:center;padding:8px 4px;background:transparent;color:#9aa0a8;letter-spacing:1px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid transparent;border-bottom:0;border-radius:10px 10px 0 0;transition:background .15s ease,color .15s ease;}",
        ".of-browser-tab:hover{color:#e8e9eb;background:rgba(255,255,255,.04);}",
        ".of-browser-tab.active{background:rgba(74,144,217,.18);color:#fff;border-color:rgba(74,144,217,.4);}",
        ".of-browser-sub{flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:8px 10px;background:transparent;color:#9aa0a8;font-size:10px;font-weight:500;}",
        ".of-browser-sub button{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#cfd3d9;font-size:10px;font-weight:600;padding:4px 13px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease;}",
        ".of-browser-sub button:hover{color:#fff;border-color:rgba(74,144,217,.5);}",
        ".of-browser-sub button.active{background:#4a90d9;border-color:#4a90d9;color:#fff;}",
        ".of-browser-grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;padding:10px;overflow-y:auto;align-content:start;}",
        ".of-tile{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.10);border-radius:12px;cursor:pointer;padding:0 0 6px;text-align:left;color:#e2e2e2;font-size:11px;font-weight:600;overflow:hidden;transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease;animation:ofRise .3s ease;}",
        ".of-tile:hover{border-color:rgba(74,144,217,.65);transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.5),0 0 18px rgba(74,144,217,.25);}",
        ".of-tile.active{border-color:#4a90d9;box-shadow:0 0 0 1px #4a90d9,0 0 18px rgba(74,144,217,.35);}",
        ".of-tile canvas{width:100%;height:64px;display:block;background:#000;}",
        ".of-tile span{display:block;padding:5px 8px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".of-hint{padding:12px;color:#9aa0a8;grid-column:1/-1;}",
        ".of-stack-list::-webkit-scrollbar,.of-params::-webkit-scrollbar,.of-browser-grid::-webkit-scrollbar{width:10px;height:10px;}",
        ".of-stack-list::-webkit-scrollbar-track,.of-params::-webkit-scrollbar-track,.of-browser-grid::-webkit-scrollbar-track{background:transparent;}",
        ".of-stack-list::-webkit-scrollbar-thumb,.of-params::-webkit-scrollbar-thumb,.of-browser-grid::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px;border:2px solid transparent;background-clip:content-box;}",
        ".of-stack-list::-webkit-scrollbar-thumb:hover,.of-params::-webkit-scrollbar-thumb:hover,.of-browser-grid::-webkit-scrollbar-thumb:hover{background:rgba(74,144,217,.5);border:2px solid transparent;background-clip:content-box;}",
        ".of-setup-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1200;display:flex;align-items:center;background:#0a0a0c;color:#eee;font-family:Inter,'Segoe UI',system-ui,-apple-system,sans-serif;overflow:hidden;animation:ofFade .3s ease;}",
        ".of-setup-bg{position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(520px 320px at 8% 8%,rgba(150,140,255,0.55),transparent 60%),radial-gradient(420px 300px at 18% 22%,rgba(90,110,255,0.35),transparent 60%),radial-gradient(180px 160px at 22% 18%,rgba(255,150,80,0.45),transparent 65%),radial-gradient(700px 420px at 78% 32%,rgba(190,170,120,0.28),transparent 62%),radial-gradient(360px 260px at 88% 62%,rgba(80,140,160,0.22),transparent 65%),linear-gradient(180deg,#2a2a33 0%,#1a1a20 38%,#050506 78%);}",
        ".of-setup-bg:after{content:'';position:absolute;top:12%;left:16%;width:220px;height:120px;background:radial-gradient(closest-side,rgba(255,255,255,0.85),rgba(255,255,255,0) 70%);filter:blur(6px);opacity:.5;}",
        ".of-setup-inner{position:relative;display:flex;width:100%;height:100%;align-items:flex-start;padding:48px 60px;gap:40px;box-sizing:border-box;}",
        ".of-setup-card{width:230px;min-height:340px;background:rgba(18,18,24,0.78);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:34px 20px;box-sizing:border-box;display:flex;flex-direction:column;gap:22px;align-items:stretch;justify-content:flex-start;box-shadow:0 12px 40px rgba(0,0,0,.55);backdrop-filter:blur(6px);animation:ofRise .4s ease;}",
        ".of-setup-btn{background:#8d8a96;color:#fff;border:0;border-radius:16px;padding:18px 10px;font-size:24px;letter-spacing:.2px;cursor:pointer;font-family:inherit;transition:background .15s ease,transform .15s ease;}",
        ".of-setup-btn:hover{background:#a5a2ae;transform:translateY(-1px);}",
        ".of-setup-btn:active{background:#7a7784;transform:none;}",
        ".of-setup-gap{flex:1;min-height:70px;}",
        ".of-setup-titles{flex:1;display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;padding-top:72px;animation:ofRise .45s ease;}",
        ".of-setup-h1{font-size:44px;font-weight:300;letter-spacing:.3px;color:#f2f2f2;margin:0;}",
        ".of-setup-h2{font-size:22px;font-weight:300;color:#e6e6e6;margin:4px 6px 0 0;}",
        ".of-setup-hint{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:rgba(255,255,255,.45);font-size:11px;letter-spacing:1px;}",
        ".of-preset-head{display:flex;align-items:center;gap:8px;}",
        ".of-preset-select{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e8e9eb;font-family:inherit;font-size:11px;padding:5px 10px;}",
        ".of-preset-select:focus{border-color:#4a90d9;outline:none;}",
        ".of-section-label{grid-column:1/-1;text-align:center;color:#9aa0a8;font-size:11px;font-weight:600;letter-spacing:1px;padding:10px 0 2px;}",
        "@media (prefers-reduced-motion:reduce){.of-window *,.of-setup-overlay *{animation:none!important;transition:none!important;}}",
    ].join("\n");

    function injectStyle() {
        if (document.getElementById("of-style")) return;
        var style = document.createElement("style");
        style.id = "of-style";
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function make(tag, cls, text) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function cssColor(rgb, alpha) {
        return (
            "rgba(" +
            Math.round(Math.max(0, Math.min(1, rgb[0])) * 255) +
            "," +
            Math.round(Math.max(0, Math.min(1, rgb[1])) * 255) +
            "," +
            Math.round(Math.max(0, Math.min(1, rgb[2])) * 255) +
            "," +
            (alpha === undefined ? 1 : alpha) +
            ")"
        );
    }

    /* ------------------------------------------------------------------ */
    /* Procedural thumbnails                                              */
    /* ------------------------------------------------------------------ */

    function thumbRandom(n) {
        var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    function drawThumb(canvas, type, tint) {
        var ctx = canvas.getContext("2d");
        var w = canvas.width;
        var h = canvas.height;
        var color = tint || (ELEMENT_TYPES[type] ? ELEMENT_TYPES[type].color : [1, 1, 1]);
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        function dot(x, y, radius, alpha, core) {
            var rad = Math.max(radius, 0.01);
            var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
            g.addColorStop(0, "rgba(255,255,255," + (core === undefined ? Math.min(1, alpha * 1.4) : core) + ")");
            g.addColorStop(0.22, cssColor(color, alpha));
            g.addColorStop(0.6, cssColor(color, alpha * 0.35));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
        }

        function ray(x, y, ang, len, width, alpha, inner) {
            var x0 = x + Math.cos(ang) * inner;
            var y0 = y + Math.sin(ang) * inner;
            var x1 = x + Math.cos(ang) * len;
            var y1 = y + Math.sin(ang) * len;
            var g = ctx.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0, cssColor(color, alpha));
            g.addColorStop(0.35, cssColor(color, alpha * 0.45));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.strokeStyle = g;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }

        switch (type) {
            case 0: { // Glow
                var gx = w * 0.4;
                var gy = h * 0.32;
                dot(gx, gy, w * 0.3, 0.22, 0.75);
                dot(gx, gy, w * 0.09, 0.42, 0.95);
                dot(gx, gy, w * 0.022, 0.9, 1);
                break;
            }
            case 1: { // Streak
                var sy = h * 0.5;
                var line1 = ctx.createLinearGradient(0, 0, w, 0);
                line1.addColorStop(0, "rgba(0,0,0,0)");
                line1.addColorStop(0.5, cssColor(color, 0.9));
                line1.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = line1;
                ctx.fillRect(0, sy - 1.5, w, 3);
                var line2 = ctx.createLinearGradient(0, 0, w, 0);
                line2.addColorStop(0, "rgba(0,0,0,0)");
                line2.addColorStop(0.5, "rgba(255,255,255,1)");
                line2.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = line2;
                ctx.fillRect(w * 0.18, sy - 0.75, w * 0.64, 1.5);
                dot(w * 0.5, sy, w * 0.035, 0.55, 1);
                break;
            }
            case 2: { // Iris
                var ix = w * 0.63;
                var iy = h * 0.58;
                var ir = w * 0.115;
                ctx.save();
                ctx.translate(ix, iy);
                ctx.beginPath();
                for (var i2 = 0; i2 <= 6; i2++) {
                    var a2 = (i2 / 6) * Math.PI * 2 + 0.35;
                    var px2 = Math.cos(a2) * ir;
                    var py2 = Math.sin(a2) * ir;
                    if (i2 === 0) ctx.moveTo(px2, py2);
                    else ctx.lineTo(px2, py2);
                }
                ctx.closePath();
                var irisGradient = ctx.createRadialGradient(0, 0, ir * 0.1, 0, 0, ir);
                irisGradient.addColorStop(0, cssColor(color, 0.3));
                irisGradient.addColorStop(0.75, cssColor(color, 0.22));
                irisGradient.addColorStop(1, cssColor(color, 0.05));
                ctx.fillStyle = irisGradient;
                ctx.shadowColor = cssColor(color, 0.5);
                ctx.shadowBlur = ir * 0.55;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = cssColor(color, 0.28);
                ctx.lineWidth = 1.2;
                ctx.stroke();
                ctx.restore();
                break;
            }
            case 3: { // Multi Iris
                var startX = w * 0.26;
                var startY = h * 0.36;
                var endX = w * 0.78;
                var endY = h * 0.62;
                for (var m = 0; m < 9; m++) {
                    var t3 = m / 8;
                    var mx = startX + (endX - startX) * t3;
                    var my = startY + (endY - startY) * t3 + (thumbRandom(m * 7.3) - 0.5) * h * 0.06;
                    var mr = w * (0.03 - 0.022 * t3);
                    var base = color;
                    if (m % 3 === 1) color = [1, 1, 1];
                    dot(mx, my, mr * 3.2, 0.28, 0.7);
                    dot(mx, my, mr, 0.8, 1);
                    color = base;
                }
                break;
            }
            case 4: { // Shimmer
                var shx = w * 0.36;
                var shy = h * 0.52;
                for (var s4 = 0; s4 < 64; s4++) {
                    var a4 = (s4 / 64) * Math.PI * 2 + (thumbRandom(s4 * 1.13) - 0.5) * 0.12;
                    var l4 = w * (0.1 + 0.34 * thumbRandom(s4 * 1.71));
                    var lw4 = 0.8 + thumbRandom(s4 * 2.31) * 1.6;
                    var al4 = 0.05 + thumbRandom(s4 * 3.17) * 0.16;
                    ray(shx, shy, a4, l4, lw4, al4, w * 0.005);
                }
                dot(shx, shy, w * 0.075, 0.45, 1);
                dot(shx, shy, w * 0.02, 0.9, 1);
                break;
            }
            case 5: { // Glint
                var glx = w * 0.44;
                var gly = h * 0.46;
                for (var k5 = 0; k5 < 4; k5++) {
                    var a5 = (k5 / 4) * Math.PI * 2 + 0.2;
                    ray(glx, gly, a5, w * 0.44, 2, 0.5, w * 0.01);
                    ray(glx, gly, a5 + Math.PI / 4, w * 0.2, 1.4, 0.35, w * 0.01);
                }
                dot(glx, gly, w * 0.16, 0.3, 0.85);
                dot(glx, gly, w * 0.045, 0.85, 1);
                break;
            }
            case 6: { // Spike Ball
                var spx = w * 0.46;
                var spy = h * 0.46;
                for (var s6 = 0; s6 < 40; s6++) {
                    var a6 = (s6 / 40) * Math.PI * 2 + (thumbRandom(s6 * 5.7) - 0.5) * 0.18;
                    var l6 = w * (0.1 + 0.26 * thumbRandom(s6 * 1.37));
                    ray(spx, spy, a6, l6, 0.9, 0.16 + 0.16 * thumbRandom(s6 * 2.9), w * 0.005);
                }
                dot(spx, spy, w * 0.15, 0.32, 0.9);
                dot(spx, spy, w * 0.035, 0.9, 1);
                break;
            }
            case 7: { // Sparkle
                var c7x = w * 0.55;
                var c7y = h * 0.48;
                for (var s7 = 0; s7 < 46; s7++) {
                    var rr7 = Math.sqrt(thumbRandom(s7 * 1.91)) * w * 0.34;
                    var aa7 = thumbRandom(s7 * 2.77) * Math.PI * 2;
                    var px7 = c7x + Math.cos(aa7) * rr7;
                    var py7 = c7y + Math.sin(aa7) * rr7;
                    var sz7 = 0.5 + thumbRandom(s7 * 3.61) * 1.5;
                    var al7 = 0.25 + thumbRandom(s7 * 4.43) * 0.6;
                    dot(px7, py7, sz7 * 2.4, al7 * 0.5, al7);
                    if (s7 % 2 === 0) {
                        ray(px7, py7, aa7, sz7 * 5, 0.7, al7 * 0.4, 0);
                        ray(px7, py7, aa7 + Math.PI / 2, sz7 * 5, 0.7, al7 * 0.4, 0);
                    }
                }
                break;
            }
            case 8: { // Ring
                var rx8 = w * 0.32;
                var ry8 = h * 0.34;
                var rad8 = w * 0.135;
                ctx.shadowColor = "rgba(150,255,180,0.8)";
                ctx.shadowBlur = 6;
                ctx.strokeStyle = "rgba(220,255,225,0.9)";
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.arc(rx8, ry8, rad8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = "rgba(255,110,110,0.55)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(rx8, ry8, rad8 - 2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = "rgba(140,255,170,0.4)";
                ctx.beginPath();
                ctx.arc(rx8, ry8, rad8 + 2, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
            case 9: { // Hoop
                var hx = w * 0.47;
                var hy = h * 0.55;
                var hrx = w * 0.4;
                var hry = h * 0.3;
                ctx.save();
                ctx.translate(hx, hy);
                ctx.rotate(-0.2);
                for (var seg = 0; seg < 72; seg++) {
                    var a0 = (seg / 72) * Math.PI * 2;
                    var a1 = ((seg + 1.35) / 72) * Math.PI * 2;
                    var hue = (seg / 72) * 360;
                    ctx.strokeStyle = "hsla(" + hue + ",92%,58%,0.85)";
                    ctx.lineWidth = 5;
                    ctx.shadowColor = "hsla(" + hue + ",92%,58%,0.85)";
                    ctx.shadowBlur = 5;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, hrx, hry, 0, a0, a1);
                    ctx.stroke();
                }
                ctx.shadowBlur = 0;
                for (seg = 0; seg < 72; seg++) {
                    a0 = (seg / 72) * Math.PI * 2;
                    a1 = ((seg + 1.2) / 72) * Math.PI * 2;
                    ctx.strokeStyle = "hsla(" + (seg / 72) * 360 + ",90%,62%,0.5)";
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, hrx * 0.8, hry * 0.8, 0, a0, a1);
                    ctx.stroke();
                }
                ctx.restore();
                break;
            }
            case 10: { // Caustic
                var cx10 = w * 0.68;
                var cy10 = h * 0.6;
                var r10 = w * 0.055;
                var cg = ctx.createRadialGradient(cx10, cy10, r10 * 0.1, cx10, cy10, r10);
                cg.addColorStop(0, "rgba(120,126,138,0.6)");
                cg.addColorStop(0.55, "rgba(160,165,178,0.5)");
                cg.addColorStop(1, "rgba(200,205,215,0.35)");
                ctx.fillStyle = cg;
                ctx.beginPath();
                ctx.arc(cx10, cy10, r10, 0, Math.PI * 2);
                ctx.fill();
                for (var b10 = 0; b10 < 6; b10++) {
                    var ab = (b10 / 6) * Math.PI * 2 + 0.3;
                    ray(cx10, cy10, ab, r10 * 0.95, 1, 0.35, 0);
                    ray(cx10, cy10, ab + Math.PI / 6, r10 * 0.6, 0.8, 0.2, 0);
                }
                ctx.shadowColor = "rgba(220,225,235,0.8)";
                ctx.shadowBlur = 3;
                ctx.strokeStyle = "rgba(225,230,240,0.7)";
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.arc(cx10, cy10, r10, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                dot(cx10, cy10, r10 * 0.35, 0.5, 0.9);
                break;
            }
            default: { // Lens Orbs
                var ox11 = w * 0.55;
                var oy11 = h * 0.5;
                for (var o = 0; o < 12; o++) {
                    var orr = w * (0.035 + 0.075 * thumbRandom(o * 1.53));
                    var oa = thumbRandom(o * 3.11) * Math.PI * 2;
                    var ord = 0.05 + 0.24 * Math.sqrt(thumbRandom(o * 2.27));
                    var ox = ox11 + Math.cos(oa) * w * ord;
                    var oy = oy11 + Math.sin(oa) * h * ord * 1.4;
                    var og = ctx.createRadialGradient(ox, oy, orr * 0.05, ox, oy, orr);
                    og.addColorStop(0, "rgba(200,205,215,0.2)");
                    og.addColorStop(0.7, "rgba(205,210,220,0.24)");
                    og.addColorStop(0.86, "rgba(225,230,240,0.3)");
                    og.addColorStop(1, "rgba(0,0,0,0)");
                    ctx.fillStyle = og;
                    ctx.beginPath();
                    ctx.arc(ox, oy, orr, 0, Math.PI * 2);
                    ctx.fill();
                }
                break;
            }
        }
        ctx.restore();
    }

    /* ------------------------------------------------------------------ */
    /* Editor window                                                      */
    /* ------------------------------------------------------------------ */

    PZ.opticalflares = PZ.opticalflares || {};

    /* Setup launcher (reference top image: "Optical flares / Setup" with Setup + Presets card) */
    PZ.opticalflares.openSetup = function (root, designer, onPick) {
        injectStyle();
        if (designer && designer.current) designer.current.close();
        var overlay = make("div", "of-setup-overlay");
        var bg = make("div", "of-setup-bg");
        var inner = make("div", "of-setup-inner");
        var card = make("div", "of-setup-card");
        var setupBtn = make("button", "of-setup-btn", "Setup");
        var gap = make("div", "of-setup-gap");
        var presetsBtn = make("button", "of-setup-btn", "Presets");
        var titles = make("div", "of-setup-titles");
        var h1 = make("h1", "of-setup-h1", "Optical flares");
        var h2 = make("div", "of-setup-h2", "Setup");
        var hint = make("div", "of-setup-hint", "ESC TO CLOSE");
        card.appendChild(setupBtn);
        card.appendChild(gap);
        card.appendChild(presetsBtn);
        titles.appendChild(h1);
        titles.appendChild(h2);
        inner.appendChild(card);
        inner.appendChild(titles);
        overlay.appendChild(bg);
        overlay.appendChild(inner);
        overlay.appendChild(hint);
        document.body.appendChild(overlay);

        function cleanup() {
            document.removeEventListener("keydown", onKey);
            if (overlay.parentElement) overlay.remove();
            if (designer && designer.current && designer.current.root === root && designer.current.isSetup) designer.current = null;
        }
        function pick(mode) {
            cleanup();
            if (onPick) onPick(mode);
            else PZ.opticalflares.openEditor(root, designer, mode);
        }
        function onKey(e) {
            if (e.key === "Escape") cleanup();
        }
        document.addEventListener("keydown", onKey);
        setupBtn.onclick = function () { pick("setup"); };
        presetsBtn.onclick = function () { pick("presets"); };
        bg.onclick = function () { /* keep open on bg click to match AE modal; Esc closes */ };
        if (designer) {
            designer.current = {
                root: root,
                isSetup: true,
                close: cleanup,
                refresh: function () {},
            };
        }
        return { close: cleanup, el: overlay };
    };

    /* Main entry: show Setup launcher first, then route to editor/presets */
    PZ.opticalflares.open = function (root, designer) {
        PZ.opticalflares.openSetup(root, designer, function (mode) {
            PZ.opticalflares.openEditor(root, designer, mode === "presets" ? "presets" : "setup");
        });
    };

    PZ.opticalflares.openEditor = function (root, designer, startMode) {
        if (designer && designer.current) designer.current.close();
        injectStyle();

        var viewport = CM.mainViewport || null;
        var viewportParent = null;
        var viewportStyle = null;
        var wasEdit = null;
        var snapshot = JSON.parse(JSON.stringify(root.toJSON()));
        var previewState = { brightness: 1, scale: 1, position: [0, 0] };
        root._designerPreview = previewState;
        var edited = false;
        var state = { target: root, block: null };
        var frame = function () {
            return CM.playback ? CM.playback.currentFrame : 0;
        };
        var ops = new PZ.ui.properties(CM);

        function time() {
            return PZ.trapcode.currentTime;
        }

        function setProperty(property, value) {
            if (!property) return;
            ops.setValue({ property: property.getAddress(), frame: Math.max(0, Math.round(frame())), value: value });
            edited = true;
        }

        function applyStack(data) {
            while (root.stack.length) root.stack.splice(root.stack.length - 1, 1);
            (data || []).forEach(function (item) {
                var element = new PZ.object3d.optflares.element();
                root.stack.push(element);
                element.load(item);
            });
        }

        function setStack(data) {
            var previous = JSON.parse(JSON.stringify(root.stack));
            applyStack(data);
            if (CM.history.operation) {
                CM.history.pushCommand(
                    function (payload) {
                        setStack(payload.data);
                    },
                    { data: previous }
                );
            }
            edited = true;
        }

        function cmdInsert(element, index) {
            root.stack.splice(index, 0, element);
            CM.history.pushCommand(
                function (payload) {
                    cmdRemove(payload.element);
                },
                { element: element }
            );
            return element;
        }

        function cmdRemove(element) {
            var index = root.stack.indexOf(element);
            if (index < 0) return;
            root.stack.splice(index, 1);
            CM.history.pushCommand(
                function (payload) {
                    cmdInsert(payload.element, payload.index);
                },
                { element: element, index: index }
            );
        }

        function cmdAdd(type) {
            var element = new PZ.object3d.optflares.element();
            element.applyType(type, true);
            return cmdInsert(element, root.stack.length);
        }

        function cmdMove(element, toIndex) {
            var from = root.stack.indexOf(element);
            if (from < 0 || toIndex < 0 || toIndex >= root.stack.length || from === toIndex) return;
            var list = [];
            for (var i = 0; i < root.stack.length; i++) list.push(root.stack[i]);
            var item = list.splice(from, 1)[0];
            list.splice(toIndex, 0, item);
            while (root.stack.length) root.stack.splice(root.stack.length - 1, 1);
            for (i = 0; i < list.length; i++) root.stack.push(list[i]);
            CM.history.pushCommand(
                function (payload) {
                    cmdMove(payload.element, payload.index);
                },
                { element: element, index: from }
            );
        }

        /* ---------------- DOM ---------------- */

        var rootEl = make("div", "of-window");
        var titlebar = make("div", "of-titlebar");

        var menus = [
            {
                name: "File",
                items: [
                    { name: "Reset All", fn: resetAll },
                    { name: "Close", fn: cancel },
                ],
            },
            {
                name: "Edit",
                items: [
                    { name: "Undo", fn: function () { CM.history.undo(); refresh(); } },
                    { name: "Redo", fn: function () { CM.history.redo(); refresh(); } },
                    { name: "Duplicate Selected", fn: duplicateSelected },
                    { name: "Delete Selected", fn: deleteSelected },
                ],
            },
            {
                name: "View",
                items: [
                    { name: "Reset Preview Settings", fn: resetPreview },
                    { name: "Toggle Guides", fn: function () { setGuides(!guidesCheck.checked); } },
                ],
            },
        ];

        var dropdowns = [];
        menus.forEach(function (menu) {
            var holder = make("div", "of-menu");
            var button = make("button", "", menu.name);
            var dropdown = make("div", "of-dropdown hidden");
            menu.items.forEach(function (item) {
                var row = make("div", "", item.name);
                row.onclick = function (event) {
                    event.stopPropagation();
                    dropdown.classList.add("hidden");
                    item.fn();
                };
                dropdown.appendChild(row);
            });
            button.onclick = function (event) {
                event.stopPropagation();
                dropdowns.forEach(function (d) {
                    if (d !== dropdown) d.classList.add("hidden");
                });
                dropdown.classList.toggle("hidden");
            };
            dropdowns.push(dropdown);
            holder.appendChild(button);
            holder.appendChild(dropdown);
            titlebar.appendChild(holder);
        });
        document.addEventListener("click", function () {
            dropdowns.forEach(function (d) {
                d.classList.add("hidden");
            });
        });

        var title = make("div", "of-title", "FLARE EDITOR — Optical Flares Options");
        var panelToggles = make("div", "of-paneltoggles", "Panels:");
        var setupBackButton = make("button", "of-bigbtn", "← Setup");
        setupBackButton.title = "Back to Optical flares Setup launcher";
        var cancelButton = make("button", "of-bigbtn", "Cancel");
        var okButton = make("button", "of-bigbtn primary", "OK");
        titlebar.appendChild(title);
        titlebar.appendChild(panelToggles);
        titlebar.appendChild(setupBackButton);
        titlebar.appendChild(cancelButton);
        titlebar.appendChild(okButton);
        setupBackButton.onclick = function () {
            // keep current edits, go back to launcher (reference top image)
            closeWindow();
            PZ.opticalflares.openSetup(root, designer, function (mode) {
                PZ.opticalflares.openEditor(root, designer, mode === "presets" ? "presets" : "setup");
            });
            refreshMain();
        };

        var body = make("div", "of-body");
        var left = make("div", "of-col of-col-left");
        var right = make("div", "of-col of-col-right");

        var previewPanel = make("div", "of-panel of-preview");
        var previewTitle = make("div", "of-panel-title");
        previewTitle.appendChild(make("span", "", "FLARE EDITOR · (SCREEN RENDER)"));
        var screen = make("div", "of-screen");
        var guides = make("div", "of-guides");
        guides.appendChild(make("span", ""));
        guides.appendChild(make("span", ""));
        screen.appendChild(guides);

        var controls = make("div", "of-preview-controls");
        var brightnessInput = make("input");
        brightnessInput.type = "number";
        brightnessInput.value = "100";
        var scaleInput = make("input");
        scaleInput.type = "number";
        scaleInput.value = "100";
        var positionXInput = make("input");
        positionXInput.type = "number";
        positionXInput.value = "0";
        var positionYInput = make("input");
        positionYInput.type = "number";
        positionYInput.value = "0";
        var guidesCheck = make("input");
        guidesCheck.type = "checkbox";
        var bgCheck = make("input");
        bgCheck.type = "checkbox";

        function labeled(text, input) {
            var label = make("label");
            label.appendChild(make("span", "", text));
            label.appendChild(input);
            return label;
        }

        controls.appendChild(labeled("Preview Brightness", brightnessInput));
        controls.appendChild(labeled("Preview Scale", scaleInput));
        controls.appendChild(labeled("Preview Position", positionXInput));
        controls.appendChild(positionYInput);
        controls.appendChild(labeled("Guides", guidesCheck));
        controls.appendChild(labeled("Show BG", bgCheck));

        var transport = make("div", "of-transport");
        var prevButton = make("button", "", "\u23EA");
        var playButton = make("button", "", "\u25B6");
        var pauseButton = make("button", "", "\u23F8");
        var nextButton = make("button", "", "\u23E9");
        var timeLabel = make("span", "of-time", "0000");
        transport.appendChild(prevButton);
        transport.appendChild(playButton);
        transport.appendChild(pauseButton);
        transport.appendChild(nextButton);
        transport.appendChild(timeLabel);
        controls.appendChild(transport);

        previewPanel.appendChild(previewTitle);
        previewPanel.appendChild(screen);
        previewPanel.appendChild(controls);

        var stackPanel = make("div", "of-panel of-stack");
        var stackTitle = make("div", "of-panel-title");
        stackTitle.appendChild(make("span", "", "Stack"));
        var stackList = make("div", "of-stack-list");
        stackPanel.appendChild(stackTitle);
        stackPanel.appendChild(stackList);

        var editorPanel = make("div", "of-panel of-editor");
        var editorTitle = make("div", "of-panel-title");
        var editorTitleText = make("span", "", "FLARE SETTINGS");
        var resetButton = make("button", "", "Reset");
        editorTitle.appendChild(editorTitleText);
        editorTitle.appendChild(make("span", "of-spacer"));
        editorTitle.appendChild(resetButton);
        var blocksBar = make("div", "of-blocks");
        var params = make("div", "of-params");
        editorPanel.appendChild(editorTitle);
        editorPanel.appendChild(blocksBar);
        editorPanel.appendChild(params);

        var browserPanel = make("div", "of-panel of-browser");
        var browserTabs = make("div", "of-browser-tabs");
        var lensObjectsTab = make("div", "of-browser-tab active", "FLARE ELEMENTS");
        var presetBrowserTab = make("div", "of-browser-tab", "PRESETS");
        browserTabs.appendChild(lensObjectsTab);
        browserTabs.appendChild(presetBrowserTab);
        var browserSub = make("div", "of-browser-sub");
        var basicTab = make("button", "active", "Basic");
        var customTab = make("button", "", "Custom");
        var lensControls = make("span", "of-preset-head");
        lensControls.appendChild(make("span", "", "Show:"));
        lensControls.appendChild(basicTab);
        lensControls.appendChild(customTab);
        var presetControls = make("span", "of-preset-head");
        presetControls.style.display = "none";
        presetControls.appendChild(make("span", "", "Presets"));
        var presetSelect = document.createElement("select");
        presetSelect.className = "of-preset-select";
        ["Cinematic", "Rainbow (8)", "Gold (8)"].forEach(function (n) {
            var o = document.createElement("option");
            o.value = n; o.textContent = n;
            presetSelect.appendChild(o);
        });
        var favBtn = make("button", "", "☆");
        favBtn.title = "Favorites only";
        presetControls.appendChild(presetSelect);
        presetControls.appendChild(favBtn);
        browserSub.appendChild(lensControls);
        browserSub.appendChild(presetControls);
        var browserGrid = make("div", "of-browser-grid");
        browserPanel.appendChild(browserTabs);
        browserPanel.appendChild(browserSub);
        browserPanel.appendChild(browserGrid);

        left.appendChild(previewPanel);
        left.appendChild(stackPanel);
        right.appendChild(editorPanel);
        right.appendChild(browserPanel);
        body.appendChild(left);
        body.appendChild(right);
        rootEl.appendChild(titlebar);
        rootEl.appendChild(body);
        document.body.appendChild(rootEl);

        /* ---------------- panel toggles ---------------- */

        var panels = [
            { name: "Preview", el: previewPanel },
            { name: "Stack", el: stackPanel },
            { name: "Editor", el: editorPanel },
            { name: "Browser", el: browserPanel },
        ];
        panels.forEach(function (panel) {
            var button = make("button", "active", panel.name);
            button.onclick = function () {
                panel.el.classList.toggle("hidden");
                button.classList.toggle("active", !panel.el.classList.contains("hidden"));
                if (viewport) viewport.resize();
            };
            panelToggles.appendChild(button);
        });

        /* ---------------- editor params ---------------- */

        var blocksFor = function (target) {
            if (target === root) {
                return [
                    { key: "flareSetup", name: "Flare Setup" },
                    { key: "global", name: "Common Settings" },
                    { key: "positioning", name: "Positioning" },
                    { key: "motionBlur", name: "Motion Blur" },
                ];
            }
            return [
                { key: "element", name: "Element" },
                { key: "globalParams", name: "Common Settings" },
                { key: "matteBox", name: "Matte Box" },
                { key: "lensTexture", name: "Lens Texture" },
            ];
        };

        var groupFor = function (target, key) {
            if (!target) return null;
            return target.properties[key];
        };

        var edit = new PZ.ui.edit(CM, {
            childFilter: function () {
                return true;
            },
            skipSingleChildren: false,
            showListItemButtons: false,
            emptyMessage: "no parameters",
            objectFilter: function () {
                return !!groupFor(state.target, state.block);
            },
            objectMap: function () {
                return groupFor(state.target, state.block);
            },
        });
        edit.title = "Parameters";
        edit.icon = "settings";
        params.appendChild(edit.el);
        edit.objects = new PZ.objectList();
        edit.objects.push(root);
        edit.enabled = true;

        function buildBlocks() {
            blocksBar.innerHTML = "";
            var blocks = blocksFor(state.target);
            if (!state.block || !blocks.some(function (b) { return b.key === state.block; })) {
                state.block = blocks.length ? blocks[0].key : null;
            }
            blocks.forEach(function (block) {
                var button = make("div", "of-block", block.name);
                button.classList.toggle("active", block.key === state.block);
                button.onclick = function () {
                    state.block = block.key;
                    buildBlocks();
                    refreshParams();
                };
                blocksBar.appendChild(button);
            });
            var group = groupFor(state.target, state.block);
            editorTitleText.textContent = group && group.displayName ? group.displayName : "Editor";
        }

        function refreshParams() {
            edit.objectsChanged();
        }

        /* ---------------- stack ---------------- */

        function buildStack() {
            stackList.innerHTML = "";
            var globalRow = make("div", "of-row of-global");
            globalRow.classList.toggle("active", state.target === root);
            var globalThumb = make("canvas");
            globalThumb.width = 88;
            globalThumb.height = 56;
            drawThumb(globalThumb, 0, [1, 1, 1]);
            globalRow.appendChild(globalThumb);
            globalRow.appendChild(make("span", "of-row-name", "Global Parameters"));
            var globalSpacer = make("span", "of-row-actions");
            var addButton = make("button", "of-mini", "ADD");
            addButton.title = "Add a Glow element";
            addButton.onclick = function (event) {
                event.stopPropagation();
                beginOperation();
                var element = cmdAdd(0);
                state.target = element;
                state.block = null;
                endOperation();
                refresh();
            };
            var scnButton = make("button", "of-mini", "SCN");
            scnButton.title = "Open the preset browser";
            scnButton.onclick = function (event) {
                event.stopPropagation();
                showPresetBrowser();
            };
            var globalColor = make("button", "of-color");
            globalColor.title = "Global Color";
            var picker = new PZ.ui.colorPicker({
                value: root.properties.global.color.get(time()).slice(),
                alpha: false,
                editStart: function () {},
                editFinish: function () {},
                changed: function (value) {
                    beginOperation();
                    setProperty(root.properties.global.color, [value[0], value[1], value[2]]);
                    endOperation();
                    globalColor.style.backgroundColor = cssColor(value);
                },
            });
            globalColor.style.backgroundColor = cssColor(root.properties.global.color.get(time()));
            globalColor.onclick = function (event) {
                event.stopPropagation();
                picker.value = root.properties.global.color.get(time()).slice();
                picker.open();
            };
            globalSpacer.appendChild(addButton);
            globalSpacer.appendChild(scnButton);
            globalSpacer.appendChild(globalColor);
            globalRow.appendChild(globalSpacer);
            globalRow.onclick = function () {
                selectTarget(root);
            };
            stackList.appendChild(globalRow);

            for (var i = 0; i < root.stack.length; i++) {
                stackList.appendChild(buildElementRow(root.stack[i], i));
            }
        }

        function buildElementRow(element, index) {
            var properties = element.properties;
            var enabled = properties.element.enabled.get(time()) === 1;
            var row = make("div", "of-row");
            row.draggable = true;
            row.classList.toggle("active", state.target === element);
            row.classList.toggle("disabled", !enabled);

            var thumb = make("canvas");
            thumb.width = 88;
            thumb.height = 56;
            drawThumb(thumb, Math.round(properties.element.elementType.get(time())), properties.globalParams.color.get(time()));
            thumb.title = "Toggle visibility";
            thumb.onclick = function (event) {
                event.stopPropagation();
                beginOperation();
                setProperty(properties.element.enabled, enabled ? 0 : 1);
                endOperation();
                refresh();
            };
            row.appendChild(thumb);

            row.appendChild(make("span", "of-row-name", properties.name.get()));

            var scaleInput = make("input");
            scaleInput.type = "number";
            scaleInput.title = "Scale";
            scaleInput.value = properties.globalParams.scale.get(time());
            scaleInput.onclick = function (event) {
                event.stopPropagation();
            };
            scaleInput.onchange = function () {
                beginOperation();
                setProperty(properties.globalParams.scale, parseFloat(scaleInput.value) || 0);
                endOperation();
            };
            row.appendChild(scaleInput);

            var distanceInput = make("input");
            distanceInput.type = "number";
            distanceInput.title = "Distance";
            distanceInput.value = properties.element.distance.get(time());
            distanceInput.onclick = function (event) {
                event.stopPropagation();
            };
            distanceInput.onchange = function () {
                beginOperation();
                setProperty(properties.element.distance, parseFloat(distanceInput.value) || 0);
                endOperation();
            };
            row.appendChild(distanceInput);

            var actions = make("span", "of-row-actions");
            var hideButton = make("button", "of-mini", "Hide");
            hideButton.classList.toggle("on", !enabled);
            hideButton.onclick = function (event) {
                event.stopPropagation();
                beginOperation();
                setProperty(properties.element.enabled, enabled ? 0 : 1);
                endOperation();
                refresh();
            };
            var soloButton = make("button", "of-mini", "Solo");
            soloButton.classList.toggle("on", !!element._solo);
            soloButton.onclick = function (event) {
                event.stopPropagation();
                element._solo = !element._solo;
                refresh();
            };
            var deleteButton = make("button", "of-mini x", "X");
            deleteButton.onclick = function (event) {
                event.stopPropagation();
                beginOperation();
                cmdRemove(element);
                if (state.target === element) {
                    state.target = root;
                    state.block = null;
                }
                endOperation();
                refresh();
            };
            actions.appendChild(hideButton);
            actions.appendChild(soloButton);
            actions.appendChild(deleteButton);
            row.appendChild(actions);

            row.onclick = function () {
                selectTarget(element);
            };
            row.ondragstart = function (event) {
                event.dataTransfer.setData("text/plain", String(index));
                event.dataTransfer.effectAllowed = "move";
            };
            row.ondragover = function (event) {
                event.preventDefault();
                row.classList.add("dragover");
            };
            row.ondragleave = function () {
                row.classList.remove("dragover");
            };
            row.ondrop = function (event) {
                event.preventDefault();
                row.classList.remove("dragover");
                var from = parseInt(event.dataTransfer.getData("text/plain"), 10);
                if (isNaN(from) || from === index) return;
                beginOperation();
                cmdMove(root.stack[from], index);
                endOperation();
                refresh();
            };
            return row;
        }

        function selectTarget(target) {
            state.target = target;
            state.block = null;
            buildBlocks();
            buildStack();
            refreshParams();
            refreshBrowser();
        }

        function beginOperation() {
            CM.history.startOperation();
        }

        function endOperation() {
            CM.history.finishOperation();
            edited = true;
        }

        function duplicateSelected() {
            if (!state.target || state.target === root) return;
            var index = root.stack.indexOf(state.target);
            if (index < 0) return;
            var copy = new PZ.object3d.optflares.element();
            copy.load(JSON.parse(JSON.stringify(state.target)));
            beginOperation();
            cmdInsert(copy, index + 1);
            endOperation();
            state.target = copy;
            refresh();
        }

        function deleteSelected() {
            if (!state.target || state.target === root) return;
            beginOperation();
            cmdRemove(state.target);
            state.target = root;
            state.block = null;
            endOperation();
            refresh();
        }

        function resetAll() {
            beginOperation();
            setStack(JSON.parse(JSON.stringify(PRESET_STACKS_DATA.default || [])));
            root.properties.load(snapshot.properties);
            endOperation();
            state.target = root;
            state.block = null;
            refresh();
        }

        /* ---------------- browser ---------------- */

        var browserMode = (startMode === "presets") ? "presets" : "lens";
        var lensMode = "basic";
        var presetCategory = "Cinematic";
        var presetFavOnly = false;
        var presetFavs = {};

        /* Reference middle image: Cinematic 8 + rainbow 8 + gold 8 */
        var CINEMATIC_NAMES = ["Afterglow", "Aircraft Light", "Alien Spotlight", "Comet", "Discreet Illumination", "Distant Flicker", "Flash In Rain", "Flash In The Darkness"];
        var RAINBOW_NAMES = ["Rainbow 01", "Rainbow 02", "Rainbow 03", "Rainbow 04", "Rainbow 05", "Rainbow 06", "Rainbow 07", "Rainbow 08"];
        var GOLD_NAMES = ["Gold 01", "Gold 02", "Gold 03", "Gold 04", "Gold 05", "Gold 06", "Gold 07", "Gold 08"];
        var CINEMATIC_KEYS = ["default", "anamorphic", "cinematic", "scifi", "sparkle", "default", "anamorphic", "cinematic"];

        function presetStackFor(category, idx) {
            var baseKey = "default";
            if (category === "Cinematic") baseKey = CINEMATIC_KEYS[idx % CINEMATIC_KEYS.length];
            else if (category === "Rainbow") baseKey = (idx % 2 === 0) ? "scifi" : "anamorphic";
            else baseKey = (idx % 2 === 0) ? "cinematic" : "sparkle";
            var base = PRESET_STACKS_DATA[baseKey] || PRESET_STACKS_DATA.default || [];
            var clone = JSON.parse(JSON.stringify(base));
            // tint rainbow / gold variants to match reference packs
            if (category === "Rainbow") {
                var hues = [[1,0.35,0.5],[0.4,0.7,1],[0.5,1,0.6],[1,0.85,0.3],[0.8,0.4,1],[0.35,1,0.9],[1,0.5,0.25],[0.6,0.6,1]];
                var tint = hues[idx % hues.length];
                clone.forEach(function (el, i) {
                    if (el.properties && el.properties.globalParams && el.properties.globalParams.color) {
                        if (i % 3 === 0) el.properties.globalParams.color = tint.slice();
                    }
                });
            } else if (category === "Gold") {
                clone.forEach(function (el) {
                    if (el.properties && el.properties.globalParams && el.properties.globalParams.color) {
                        el.properties.globalParams.color = [1, 0.82 - (idx % 4) * 0.05, 0.45];
                    }
                });
            }
            return clone;
        }
        function presetThumbType(category, idx) {
            if (category === "Rainbow") return [9, 8, 1, 5, 9, 4, 8, 1][idx % 8];
            if (category === "Gold") return [5, 0, 4, 3][idx % 4];
            return [1, 1, 1, 0, 1, 1, 0, 0][idx % 8];
        }

        function showPresetBrowser() {
            browserMode = "presets";
            refreshBrowser();
        }

        function showLensBrowser(mode) {
            browserMode = "lens";
            lensMode = mode;
            refreshBrowser();
        }

        lensObjectsTab.onclick = function () {
            browserMode = "lens";
            refreshBrowser();
        };
        presetBrowserTab.onclick = function () {
            browserMode = "presets";
            refreshBrowser();
        };
        basicTab.onclick = function () {
            lensMode = "basic";
            refreshBrowser();
        };
        customTab.onclick = function () {
            lensMode = "custom";
            refreshBrowser();
        };

        function tile(label, type, onClick, active) {
            var el = make("div", "of-tile");
            if (active) el.classList.add("active");
            var canvas = make("canvas");
            canvas.width = 220;
            canvas.height = 124;
            drawThumb(canvas, type, ELEMENT_TYPES[type] ? ELEMENT_TYPES[type].color : [1, 1, 1]);
            el.appendChild(canvas);
            el.appendChild(make("span", "", label));
            el.onclick = onClick;
            return el;
        }

        function selectedElementType() {
            if (!state.target || state.target === root) return -1;
            if (!state.target.properties || !state.target.properties.element) return -1;
            return Math.round(state.target.properties.element.elementType.get(time()));
        }

        presetSelect.onchange = function () {
            var v = presetSelect.value;
            if (v.indexOf("Rainbow") === 0) presetCategory = "Rainbow";
            else if (v.indexOf("Gold") === 0) presetCategory = "Gold";
            else presetCategory = "Cinematic";
            refreshBrowser();
        };
        favBtn.onclick = function () {
            presetFavOnly = !presetFavOnly;
            favBtn.classList.toggle("active", presetFavOnly);
            favBtn.textContent = presetFavOnly ? "★" : "☆";
            refreshBrowser();
        };

        function refreshBrowser() {
            lensObjectsTab.classList.toggle("active", browserMode === "lens");
            presetBrowserTab.classList.toggle("active", browserMode === "presets");
            basicTab.classList.toggle("active", lensMode === "basic");
            customTab.classList.toggle("active", lensMode === "custom");
            lensControls.style.display = browserMode === "lens" ? "" : "none";
            presetControls.style.display = browserMode === "presets" ? "" : "none";
            browserGrid.innerHTML = "";

            if (browserMode === "presets") {
                var names = presetCategory === "Rainbow" ? RAINBOW_NAMES : presetCategory === "Gold" ? GOLD_NAMES : CINEMATIC_NAMES;
                var tintFor = function (idx) {
                    if (presetCategory === "Rainbow") return [[1,0.5,0.7],[0.5,0.8,1],[0.6,1,0.6],[1,0.9,0.4],[0.8,0.5,1],[0.4,1,0.9],[1,0.6,0.3],[0.7,0.7,1]][idx % 8];
                    if (presetCategory === "Gold") return [1, 0.8, 0.5];
                    return [1, 1, 1];
                };
                names.forEach(function (name, idx) {
                    var favKey = presetCategory + ":" + name;
                    if (presetFavOnly && !presetFavs[favKey]) return;
                    var wrap = make("div", "of-tile");
                    var canvas = make("canvas");
                    canvas.width = 220;
                    canvas.height = 124;
                    drawThumb(canvas, presetThumbType(presetCategory, idx), tintFor(idx));
                    wrap.appendChild(canvas);
                    var labelRow = make("span", "");
                    labelRow.textContent = (presetFavs[favKey] ? "★ " : "☆ ") + name;
                    labelRow.title = "Click tile to apply, click ☆/★ to fav";
                    labelRow.style.cursor = "pointer";
                    labelRow.onclick = function (ev) {
                        ev.stopPropagation();
                        presetFavs[favKey] = !presetFavs[favKey];
                        refreshBrowser();
                    };
                    wrap.appendChild(labelRow);
                    wrap.onclick = function () {
                        beginOperation();
                        setStack(presetStackFor(presetCategory, idx));
                        endOperation();
                        state.target = root;
                        state.block = null;
                        refresh();
                    };
                    browserGrid.appendChild(wrap);
                });
                var sectionTxt = presetCategory === "Cinematic" ? "8 cinematic presets · Afterglow → Flash In The Darkness" : presetCategory === "Rainbow" ? "8 rainbow flares presets" : "8 gold flares presets";
                browserGrid.appendChild(make("div", "of-section-label", sectionTxt));
                // legacy stacks still accessible
                PZ.object3d.optflares.PRESETS.forEach(function (preset) {
                    var el = make("div", "of-tile");
                    var canvas = make("canvas");
                    canvas.width = 220;
                    canvas.height = 124;
                    var thumbType = preset.key === "sparkle" ? 7 : preset.key === "scifi" ? 9 : preset.key === "anamorphic" ? 1 : 0;
                    drawThumb(canvas, thumbType, [1, 1, 1]);
                    el.appendChild(canvas);
                    el.appendChild(make("span", "", preset.name));
                    el.onclick = function () {
                        beginOperation();
                        setStack(JSON.parse(JSON.stringify(PRESET_STACKS_DATA[preset.key] || [])));
                        endOperation();
                        state.target = root;
                        state.block = null;
                        refresh();
                    };
                    browserGrid.appendChild(el);
                });
                return;
            }

            if (lensMode === "basic") {
                var activeType = selectedElementType();
                ELEMENT_TYPES.forEach(function (type, index) {
                    browserGrid.appendChild(
                        tile(
                            type.name,
                            index,
                            function () {
                                beginOperation();
                                var element = cmdAdd(index);
                                endOperation();
                                state.target = element;
                                state.block = null;
                                refresh();
                            },
                            index === activeType
                        )
                    );
                });
                return;
            }

            var layers = root.properties.positioning.customLayers;
            [layers.layer1, layers.layer2, layers.layer3].forEach(function (layer, index) {
                var set = !!layer.get(time());
                browserGrid.appendChild(
                    tile(set ? "Custom Layer " + (index + 1) : "Custom " + (index + 1) + " (empty)", 0, function () {
                        if (!layer.get(time())) return;
                        beginOperation();
                        var element = cmdAdd(0);
                        setProperty(element.properties.lensTexture.textureImage, index + 7);
                        endOperation();
                        state.target = element;
                        state.block = null;
                        refresh();
                    })
                );
            });
            browserGrid.appendChild(
                make("div", "of-hint", "Assign Custom Layers in the Object panel > Positioning Mode > Custom Layers, then use them as a Lens Texture.")
            );
        }

        /* ---------------- preview wiring ---------------- */

        function applyPreview() {
            previewState.brightness = Math.max(0, parseFloat(brightnessInput.value) / 100) || 1;
            previewState.scale = Math.max(0, parseFloat(scaleInput.value) / 100) || 1;
            previewState.position = [parseFloat(positionXInput.value) || 0, parseFloat(positionYInput.value) || 0];
            if (previewState.brightness > MAX_PREVIEW_BRIGHTNESS / 100) previewState.brightness = MAX_PREVIEW_BRIGHTNESS / 100;
        }

        brightnessInput.oninput = applyPreview;
        scaleInput.oninput = applyPreview;
        positionXInput.oninput = applyPreview;
        positionYInput.oninput = applyPreview;
        function setGuides(on) {
            guidesCheck.checked = on;
            guides.classList.toggle("on", on);
        }
        guidesCheck.onchange = function () {
            setGuides(guidesCheck.checked);
        };
        bgCheck.onchange = function () {
            screen.classList.toggle("checker", bgCheck.checked);
        };

        function resetPreview() {
            brightnessInput.value = "100";
            scaleInput.value = "100";
            positionXInput.value = "0";
            positionYInput.value = "0";
            applyPreview();
            setGuides(false);
            bgCheck.checked = false;
            screen.classList.remove("checker");
        }

        playButton.onclick = function () {
            if (CM.playback) {
                CM.playback.speed = 1;
            }
        };
        pauseButton.onclick = function () {
            if (CM.playback) {
                CM.playback.speed = 0;
            }
        };
        prevButton.onclick = function () {
            if (CM.playback) {
                CM.playback.speed = 0;
                CM.playback.currentFrame = Math.max(0, frame() - 1);
            }
        };
        nextButton.onclick = function () {
            if (CM.playback) {
                CM.playback.speed = 0;
                CM.playback.currentFrame = frame() + 1;
            }
        };

        resetButton.onclick = function () {
            var group = groupFor(state.target, state.block);
            if (!group) return;
            CM.history.startOperation();
            ops.resetAll(group);
            CM.history.finishOperation();
            edited = true;
            refresh();
        };

        /* ---------------- refresh / close ---------------- */

        function refresh() {
            buildBlocks();
            buildStack();
            refreshParams();
            refreshBrowser();
            timeLabel.textContent = String(Math.max(0, Math.round(frame()))).padStart(4, "0");
        }

        function tick() {
            timeLabel.textContent = String(Math.max(0, Math.round(frame()))).padStart(4, "0");
        }

        function closeWindow() {
            if (state.interval) {
                clearInterval(state.interval);
                state.interval = null;
            }
            if (edit) edit.enabled = false;
            root._designerPreview = null;
            document.removeEventListener("click", hideDropdowns_bound);
            document.removeEventListener("keydown", onKeydown);
            window.removeEventListener("resize", onResize);
            if (viewport && viewportParent) {
                viewport.el.setAttribute("style", viewportStyle || "");
                viewportParent.appendChild(viewport.el);
                viewport.edit = wasEdit;
                viewport.resize();
            }
            rootEl.remove();
            if (designer) designer.current = null;
        }

        function hideDropdowns_bound() {
            dropdowns.forEach(function (d) {
                d.classList.add("hidden");
            });
        }

        function cancel() {
            if (edited) {
                beginOperation();
                setStack(snapshot.stack);
                root.properties.load(snapshot.properties);
                endOperation();
                state.target = root;
                state.block = null;
            }
            closeWindow();
            refreshMain();
        }

        function ok() {
            closeWindow();
            refreshMain();
        }

        function refreshMain() {
            if (typeof CM !== "undefined" && CM.project && CM.project.ui && CM.project.ui.onChanged) {
                CM.project.ui.onChanged.update();
            }
            if (CM._allTimelines) {
                CM._allTimelines.forEach(function (timeline) {
                    if (timeline && timeline.tracks) timeline.tracks.update && timeline.tracks.update();
                });
            }
        }

        var onResize = function () {
            if (viewport) viewport.resize();
        };
        var onKeydown = function (event) {
            if (event.key === "Escape") cancel();
            else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) ok();
        };
        cancelButton.onclick = cancel;
        okButton.onclick = ok;
        window.addEventListener("resize", onResize);
        document.addEventListener("keydown", onKeydown);
        document.removeEventListener("click", hideDropdowns_bound);
        document.addEventListener("click", hideDropdowns_bound);

        if (viewport && viewport.el) {
            viewportParent = viewport.el.parentElement;
            viewportStyle = viewport.el.getAttribute("style");
            wasEdit = viewport.edit;
            viewport.edit = false;
            screen.insertBefore(viewport.el, guides);
            requestAnimationFrame(function () {
                if (viewport) viewport.resize();
            });
        }

        buildBlocks();
        buildStack();
        refreshParams();
        refreshBrowser();
        state.interval = setInterval(tick, 250);
        if (designer) {
            designer.current = {
                root: root,
                close: closeWindow,
                refresh: refresh,
            };
        }
    };

    var PRESET_STACKS_DATA = (function () {
        var stacks = PZ.object3d.optflares.PRESET_STACKS;
        var out = {};
        for (var key in stacks) {
            out[key] = stacks[key].map(function (spec) {
                var element = new PZ.object3d.optflares.element();
                element.applyType(spec.type, false);
                var p = element.properties;
                p.element.elementType.set(spec.type);
                p.element.distance.set(spec.distance);
                p.element.rotation.set(spec.rotation || 0);
                p.element.opacity.set(spec.opacity);
                p.element.animate.set(1);
                p.globalParams.scale.set(spec.scale);
                p.globalParams.aspectRatio.set(spec.aspect);
                p.globalParams.blendMode.set(spec.blend || 0);
                p.globalParams.color.set(spec.color.slice());
                p.globalParams.globalSeed.set(spec.seed);
                p.lensTexture.textureImage.set(spec.texture);
                return JSON.parse(JSON.stringify(element));
            });
        }
        return out;
    })();
})();
