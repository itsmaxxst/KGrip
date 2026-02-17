const { remote, ipcRenderer } = require('electron');

// Initialize segmented gauge with custom range
const canvas = document.getElementById('gaugeCanvas');
// Change maxValue to 50 or 60 depending on your device
const gauge = new GaugeSegmented(canvas, 0, 60); // Default to 0-60 range

// Start animation
gauge.animate();

// The gauge will be shown when ready to measure the grip strength
// Between the measures, when the timer starts, the gauge will be gray & disabled
canvas.style.display = 'none';

ipcRenderer.on('kforce-data', (event, payload) => {
    if (!payload) return;

    switch (payload.message) {
        case "measure_received":
            canvas.style.display = 'block';
            canvas.style.filter = "grayscale(0)";
            canvas.style.opacity = 1;
            gauge.setValue(parseFloat(payload.value));
            break;

        case "measure_finish":
            canvas.style.display = 'block';
            canvas.style.filter = "grayscale(0.5)";
            canvas.style.opacity = 0.4;
            gauge.setValue(parseFloat(0));
            console.log("Measurement finished", payload);
            break;

        case "baseline_ok":
            canvas.style.display = 'block';
            canvas.style.filter = "grayscale(0)";
            canvas.style.opacity = 1;
            console.log("Baseline OK");
            break;

        case "baseline_stop":
            canvas.style.display = 'none';
            console.log("Baseline Stop");
            break;
        
        case "hide_gauge":
            canvas.style.display = 'none';
            console.log("Gauge hidden");
            break;
        
         case "show_gauge":
            canvas.style.display = 'block';
            console.log("Gauge shown");
            break;

        case "measureSamplingOn":
            canvas.style.display = 'block';
            gauge.setValue(parseFloat(0));
            console.log("Sampling On");
            break;

        case "timeout":
            canvas.style.display = 'none';
            gauge.setValue(parseFloat(0));
            console.log("Timeout");
            break;
    }
});
