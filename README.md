For this to work you have to follow the files structure as shown:

src folder -> gauge-segmented.js, index.html, renderer-segmented.js
out of the src folder -> debug.log (create an empty file, it will populate with the debug logs), queue.js, temp.json, config.json, main.js

Note: also you can add a fonts folder containing fonts in .ttf format in the src folder
Note: create a test app out of this project that will send via zeromq (to the same address) the following messages so it can communicate with the device (measureStart, measureSamplingOn, measureStop), this test project will communicate with the plugin sending him back messages (front-end emulation), implement this how you want it is based on your goal 
