            // Dual Input: begin
            // Hands the instrument the sim just set up to the panel bridge, or queues it until
            // the bridge loads, never delaying it.
            try {
                if (window.DUALINPUT_BRIDGE_API) {
                    window.DUALINPUT_BRIDGE_API.add(template);
                }
                else {
                    window.DUALINPUT_BRIDGE_PENDING.push(template);
                }
            }
            catch (e) {
            }
            // Dual Input: end
