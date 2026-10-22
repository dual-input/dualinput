// Dual Input: begin
// Loads the panel bridge through a script element of our own, outside the sim's script
// loader, which loads one script at a time and would hold every instrument's scripts behind
// a file of ours that never loads (record/areas/core/02-clients-and-panel-bridge.md, "Our
// VCockpit.js"). Everything here runs in a try, so a cockpit runs as it would without us.
var DUALINPUT_BRIDGE_PENDING = [];
try {
    (function () {
        var script = document.createElement("script");
        script.src = "/DualInput/bridge.js";
        (document.head || document.documentElement).appendChild(script);
    })();
}
catch (e) {
}
// Dual Input: end
