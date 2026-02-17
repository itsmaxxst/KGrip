const { app, BrowserWindow } = require('electron');
const path = require('path');
const { ipcMain } = require('electron');

//Imports
const fs = require("fs");
const util = require("util");
const zeromq = require('zeromq');
const Big = require('big.js');
const { SerialPort } = require('serialport');
const { ByteLengthParser } = require('@serialport/parser-byte-length');
const JobQueue = require('./queue');

// Definitions
const dealer = new zeromq.Dealer();
let config = {}
let measureStarted = false;
let tempFile = {
  hardware: "KForceGrip",
  inputData: {},
  outputData: {},
  messages: [],
};
let socketPath = undefined;
let errorFile = false;
let errorFlag = null;
let port = undefined;
let algorithmTimeout = undefined;
let coef = 0;
let first = true;
let startTimeoutMeasurement = false;
let stopMeasurement = false;
let baseline = 0;
let num = 0;
let weight = 0;
let weightMax = 0;
let weightArray = [];

// Timeout definitions
let timeoutForStartSampling = undefined;
let timeoutForCancelSamplingTimeout = undefined;

// the timer for searching the usb device
let searchUsbInterval = undefined;

// the timer for the actual measurement
let measurementTimeout = undefined;

// the callback to communicate with indexService
let callback = undefined;

// Queue definition
const queue = new JobQueue({ concurrency: 1, retryDelay:0, timeout: 1 });

// Listen to events
queue.on('job:added', (job) => {
  log(4,`a Job added: ${job.id} (${job.type})`);
});
queue.on('job:start', (job) => {
  log(4,`p Processing: ${job.id} (attempt ${job.attempts})`);
});
queue.on('job:completed', (job, result) => {
  log(4,`c Completed: ${job.id} - Result: ${result}`);
});
queue.on('job:failed', (job, error) => {
  log(4,`x Failed: ${job.id} - ${error.message}`);
});
queue.on('job:retry', (job) => {
  log(4,`r Retrying: ${job.id} (attempt ${job.attempts})`);
});
queue.process('zeromqSendMessage', 
  // Your async work here
  async (data) => {
    await new Promise((resolve, reject) => {
      // Call the async operation and resolve/reject when it finishes
      dealer.send(data.message)
        .then(() => { // success -> resolve the outer promise
          log(4, `---> Sent message ${data.message}`)
          return resolve;
        })        
        .catch(reject);         // error   -> reject  the outer promise
    });
    return `Sent message ${data.message}`;
  }
  );
// end queue definitions

/**
 * KForceGrip commands
 * 
 * 0x20 --> Set Coefficient
 * 0x21 --> Get Coefficient
 * 0x10 --> Set Sampling = off
 * 0x11 --> Set Sampling = on
 * 0x7a --> Deactivate device
 * 
 */
const SetCoef     = 0
const GetCoef     = 1
const SamplingOff = 2
const SamplingOn  = 3
const DeviceOff   = 4
const commandCode = 0
const commandDesc = 1

const commands = []
commands[SetCoef]     = [new Buffer.from([0x20]), "Set Coefficient"]
commands[GetCoef]     = [new Buffer.from([0x21]), "Get Coefficient"]
commands[SamplingOff] = [new Buffer.from([0x10]), "Sampling off"]
commands[SamplingOn]  = [new Buffer.from([0x11]), "Sampling on"]
commands[DeviceOff]   = [new Buffer.from([0x7a]), "Deactivate device"]

/**
 *
 * @param {Error=} error
*/
function endAlgorithm(error, errorMessage) {
  if (algorithmTimeout) clearTimeout(algorithmTimeout);
  let arrayMap = [
    [1, "Error on temp.json file"],
    [2, "No device Found"],
    [3, "Generic Error on device"],
    [4, "CK Error"],
    [5, "Generic Error on plugin"],
    [6, "Timeout, check if the device is connected and retry"],
    [7, "No data or invalid data"],
  ];
  if (error && error > 7) arrayMap.push([error, errorMessage]);
  let errorMap = new Map(arrayMap);
  if (error) {
    console.error(errorMap.get(error));
    if (!tempFile.messages) tempFile.messages = [];
    tempFile.messages.push({
      code: error,
      message: errorMap.get(error),
    });
    if (port) {
      sendCommand(commands[DeviceOff]);  
      port && port.isOpen && port.close();
      port = undefined;
    }
  }
  first = true;

  stopMeasurement = false;
  startTimeoutMeasurement = false;
  weightArray.length = 0;
  baseline = 0;
  measureStarted = false;

  if (port) {
     sendCommand(commands[SamplingOff]);
  }

  fs.writeFile("./temp.json", JSON.stringify(tempFile), (err) => {
    if (err) return console.error(err);
    log(3, "Temp.json file written");
    tempFile = {
      hardware: "KForceGrip",
      inputData: {},
      outputData: {},
      messages: [],
    }
  });
}

/**
 * sendCommand
 * @param {*} command 
 */
function sendCommand(command) {
  port &&
    port.write(command[commandCode], (err) => {
      if (err) {
        log(1, "Error on send command: ", err.message);
        return endAlgorithm(3);
      }
      log(3, "command sent:", command[commandDesc]);
    });
  if(!port) {
    log(1, "Port Not Opened", command);
  }
}

/**
 * loadFile
 * @param {*} file 
 */
function loadFile(file) {
  // Checks for config & temp
  const exeDir = path.dirname(process.execPath);
  const externalPath = path.join(exeDir, file);
  const userPath = path.join(app.getPath("userData"), file);
  const defaultPath = path.join(app.getAppPath(), file);
  try {

    // Checks for file in .exe path
    if(fs.existsSync(externalPath)){
      console.log(`Loading ${file} from exe directory`);
      const raw = fs.readFileSync(externalPath, 'utf8');
      return JSON.parse(raw);
    }

    // Checks for file in UserData if it's missing in .exe path
    if(fs.existsSync(userPath)){
      console.log(`Loading ${file} from UserData`);
      const raw = fs.readFileSync(userPath, 'utf8');
      return JSON.parse(raw);
    }

    // Copy file from app.asar if file is not found in UserData
    console.log(`Copying ${file} to UserData`);

    if(fs.existsSync(defaultPath)){
      const raw = fs.readFileSync(defaultPath, 'utf8');
      fs.writeFileSync(userPath, raw);
      return JSON.parse(raw);
    }

    console.log(`Default ${file} not found in appPath`);
    return {};
  } catch (err) {
    console.error(`Failed to load ${file}: `, err);
    return {};
  }
}

config = loadFile('config.json');

tempFile = loadFile('temp.json');

// Console LOG customization
if (config.logFilePath) {
  var logFile = fs.createWriteStream(config.logFilePath, { flags: "a" });
  var logStdout = process.stdout;

  console.log = config.debug
    ? function () {
        let ts = Date.now();

        let date_time = new Date(ts);
        let date = date_time.getDate();
        let month = date_time.getMonth() + 1;
        let year = date_time.getFullYear();
        let hours = date_time.getHours();
        let minutes = date_time.getMinutes();
        let seconds = date_time.getSeconds();
        logFile.write(
          "[" +
            year +
            "/" +
            month +
            "/" +
            date +
            "-" +
            hours +
            ":" +
            minutes +
            ":" +
            seconds +
            "] " +
            util.format.apply(null, arguments) +
            "\n"
        );
        logStdout.write(
          "[" +
            year +
            "/" +
            month +
            "/" +
            date +
            "-" +
            hours +
            ":" +
            minutes +
            ":" +
            seconds +
            "] " +
            util.format.apply(null, arguments) +
            "\n"
        );
      }
    : console.log;

  console.error = config.debug ? console.log: console.error;
  console.warn  = config.debug ? console.log: console.warn;
  console.info  = config.debug ? console.log: console.info;
  console.debug = config.debug ? console.log: console.debug;
    
}

const debugLevel = config.debugLevel || 0;
/**
 * Log helper that respects the current debug level.
 * @param {number} level - Desired log level (1-4)
 * @param {...any} args - Values to log
 */
function log(level, ...args) {
  if (debugLevel >= level) {
    switch (level) {
      case 1: console.error(...args); break;   // Error
      case 2: console.warn(...args);  break;   // Warning
      case 3: console.info(...args);  break;   // Info
      case 4: console.debug(...args); break;   // Verbose/debug
      default: console.log(...args);
    }
  }
}

const endpoint = "tcp://" + config.socket.zeromqIp + ":" + config.socket.zeromqPort;

// dealer zeroMq listener msg from POD
async function listenZmq() {
  for await (const [msg] of dealer) {
    try {
      const message = JSON.parse(msg.toString());

      log(3, "ZMQ messagge received: ", message);

      if (!message.inputData || !message.inputData.cmd) return;

      switch (message.inputData.cmd) {
        case "measureStart":
          startDetectDevice();
          break;

        case "measureSamplingOn":
          startMeasure();
          break;

        case "measureStop":
          stopMeasure();
          emitMessage({ message: "app_hide" });
          break;

        case "appHide":
          stopMeasure();
          emitMessage({ message: "app_hide" });
          break;

        case "appShow":
          stopMeasure();
          emitMessage({ message: "app_show" });
          break;
        
        case "showGauge":
          emitMessage({ message: "show_gauge" });
          break;

        case "hideGauge":
          emitMessage({ message: "hide_gauge" });
          break;
      }

    } catch (err) {
      log(1, "Invalid ZMQ message:", err);
    }
  }
}

// dealer zeroMq bind
async function initZmq() {
  try {
    await dealer.bind(endpoint);
    log(3, "ZeroMQ bind on endpoint:", endpoint);
    listenZmq(); 
  } catch (error) {
    log(1, "ZeroMQ socket problem: " + error);
  }
}

initZmq();

/**
 * zeromqSendMessage
 * @param {*} msg 
 */
function zeromqSendMessage(msg) {  
  // Add jobs
  queue.add('zeromqSendMessage', { message: msg } );
}

/**
 * registerCallback
 * @param {*} cb 
 * Used by Electron main process to save the callback function
 * injects a renderer communication function (classic DI)
 */
function registerCallback(cb){
  callback = cb;
}

/**
 * emitMessage
 * @param {*} payload 
 * sends payload to: 
 * 1) Electron (via registered callback) - for the gauge
 * 2) POD (via zeroMq queue)
 * output flow unified
 */
function emitMessage(payload) {  
  //Send msg to POD & Electron gauge
  //Electron
  if(callback){
    callback(payload);
  }
  //POD
  zeromqSendMessage(JSON.stringify({ outputData: payload }));
}

/**
 * startDetectDevice
 * @param {*} cb 
 */
function startDetectDevice(cb) {
  if(cb) callback = cb;
  algorithmTimeout = setTimeout(() => {
    clearInterval(searchUsbInterval);
    if (!socketPath) return endAlgorithm(2);
    log(1, "Timeout, nobody showed up");
    emitMessage({ message: "timeout" });
    return endAlgorithm(6);
  }, config.timeout); // 1/2 minute to general timeout + 5 seconds of start measurement

  log(3, "Searching K-Grip...");
  if (!port) {
    searchUsbInterval = setInterval(() => {
      log(4, ".");
      SerialPort.list()
        .then((data) => {
          data.some((device) => {
            //console.log(device)
            if (
              device.productId == config.productId &&
              device.vendorId == config.vendorId
            ) {
              socketPath = device.path;
              log(3, "Found it on path:", socketPath);
              log(3, "wait to set baseline");
              clearInterval(searchUsbInterval);
              emitMessage({ message: "device_found" });
              KGrip(socketPath);
            }
          });
        })
        .catch((error) => {
          log(1, error);
          endAlgorithm(5);
        });
      }, 1000);
  } else if (port.isOpen){
    emitMessage({ message: "device_found" });
    KGrip(socketPath);
  }
}

/**
 * KGrip
 * @param {*} socketPath 
 */
function KGrip(socketPath) {
  if(!port){
    port = new SerialPort(
      {
        path: socketPath,
        baudRate: 115200,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
       },
    );
  
    port.on('error', error => log(1, error))
  
    port.on('open', () =>{
      log(3, "Connected");
      // Send Coef reading message
      sendCommand(commands[SamplingOff]);
      sendCommand(commands[GetCoef]);
      setTimeout(() => {
        // Setting parser trigger event on ByteLength 11
        const parser = port.pipe(new ByteLengthParser({ length: 11 }));
        parser.on("data", checkResponse);
        // Sampling=On
        sendCommand(commands[SamplingOn]);
        }, config.samplingDelay);
    }
  )
  
    port.on("data", (data) => {
      if (data.length === 6) {
        // Reading the Coef
        coef = data.toString() / 1000000;
        log(3, "Coef: ", coef);
      }
    });
  } else if (port.isOpen){
    log(1, "Error: port already opened, wrong flow")
    sendCommand(commands[DeviceOff]);
    log(1, "Error: Closing Port ", port.path);
    setTimeout(() => {
      port && port.isOpen && port.close();
      port = undefined;            
      }, 200);
  }

  /**
   *
   * @param {data} buffer
   */
  function checkResponse(data) {
    //
    //  Read value from the Nth measurement packets
    //
    //    eg. FF FF FE 0D AC 00 00 00 00 00 40
    //
    //    concat the 3rd and 4rd byte and convert it to int
    //    eg. 0D, AC --> '0DAC' --> to int --> 3500
    //

    // The first packet contain the Baseline
    const value = parseInt(
      data[3]
        .toString(16)
        .padStart(2, "0")
        .concat(data[4].toString(16).padStart(2, "0")),
      16
    );

    if (first) {
      /**
       * If the value does not remain above config.baseline for at least 3 seconds,
       * the baseline will not be set
       */
      if (
        value > config.baseline &&
        (!timeoutForStartSampling || timeoutForStartSampling._destroyed)
      ) {
        clearTimeout(timeoutForCancelSamplingTimeout);
        log(3, "Potential Baseline:", value, config.baseline);

        timeoutForCancelSamplingTimeout = undefined;
        log(3, "start timeout for start sampling");
        timeoutForStartSampling = setTimeout(() => {
          // Set the baseline only if num > config.baseline
          baseline = value;
          num = value;
          //console.log('Baseline: ', baseline)
          first = false;
          log(3, "baseline ok, start measure :", baseline);
          weightMax = 0;
          emitMessage({ message: "baseline_ok" });
          mainWindow.show();
          mainWindow.setAlwaysOnTop(true, "screen-saver");
          mainWindow.moveTop();
          mainWindow.focus();
        }, config.baselineTimeSetting);
      }
      // if the value is below the baseline threshold:
      // - clear the eventual previsous timeout
      // - start a timer to cancel the above timer. If a value bigger than config.baseline
      // is detected within 500ms, this timer will be cancelled
      else if (value < config.baseline && !timeoutForCancelSamplingTimeout) {
        clearTimeout(timeoutForCancelSamplingTimeout);
        timeoutForCancelSamplingTimeout = setTimeout(() => {
          clearTimeout(timeoutForStartSampling);
          log(3, "baseline_stop");
          emitMessage({ message: "baseline_stop", code: 1001 });
          timeoutForStartSampling = undefined;
        }, config.baselineTimeNotSet);
      }
    } else {
      // Weight formula, in [Kg]:
      // Weight = (Baseline - Nth value) * Coef
      // weight = Math.abs((baseline - value) * coef)
      const b = new Big(baseline);
      weight = b
        .minus(value)
        .times(coef)
        .abs()
        .round(config.bigRound)
        .toNumber();
      if (weight > config.trigger) {
        // trigger start if weight > 0.8 value
        if (!startTimeoutMeasurement) {
          log(3, "Start Measurement");

          clearTimeout(algorithmTimeout);
          measurementTimeout = setTimeout(() => {
            // set a 5 sec timeout for the measurement duration
            stopMeasurement = true;
            log(3, "Stop Measurement");
            errorFlag = "00";
            checkError(errorFlag, (error, errorMessage) => {
              if (error) return endAlgorithm(error, errorMessage);
              tempFile.outputData.weightMax = weightMax.toFixed(1);
              tempFile.outputData.weightArray = JSON.stringify(weightArray);
              tempFile.outputData.weightMedia = (
                weightArray.reduce((a, b) => a + b, 0) / weightArray.length
              ).toFixed(1);
              // Showing results
              log(3, "Baseline: ", baseline);
              log(3, "Coef: ", coef);
              log(3, "Num measures: ", weightArray.length);
              log(3, "WeightMax: ", tempFile.outputData.weightMax, "Kg");
              log(3, "WeightAVG: ", tempFile.outputData.weightMedia, "Kg");

              emitMessage({
                message: "measure_finish",
                rawMeasures: tempFile.outputData.weightArray,
                avg: tempFile.outputData.weightMedia,
                max: tempFile.outputData.weightMax,
              });
              return endAlgorithm();
            });
          }, config.duration);
          startTimeoutMeasurement = true;
        }
        if (weight < config.ceilWeight && !stopMeasurement) {
          // take the weight value if valid (less than < config.ceilWeight) and if measurement is running
          if (weight > weightMax) {
            // updating weightMax
            weightMax = weight;
          }
          weightArray.push(weight);
          emitMessage({ message: "measure_received", value: weight.toFixed(1) });
          log(3, "Weight: ", weight.toFixed(1), " - WeightMax: ", weightMax.toFixed(1))
        }
      }
    }
  }

  /**
   *
   * @param {String} error
   * @param {Function} callback
   */
  function checkError(error, callback) {
    let errorMessage;
    switch (error) {
      case "00":
        errorMessage = "Results with no error found";
        return callback(null, errorMessage);
        break;
    }
    return callback(error, errorMessage);
  }
}

/**
 * startMeasure
 * @param {*} cb 
 */
function startMeasure(cb) {
  if(cb) callback = cb;
  algorithmTimeout = setTimeout(()=>{
    log(1, "timeout during measureSamplingOn");
    emitMessage({ message: "timeout" });
    endAlgorithm(6);
  },config.timeout);

  emitMessage({ message: "measureSamplingOn" });
  sendCommand(commands[SamplingOn]);
}

/**
 * stopMeasure
 */
function stopMeasure() {
  
  // Clearing all the timeouts
  algorithmTimeout && clearTimeout(algorithmTimeout);
  timeoutForStartSampling && clearTimeout(timeoutForStartSampling);
  timeoutForCancelSamplingTimeout && clearTimeout(timeoutForCancelSamplingTimeout);
  measurementTimeout && clearTimeout(measurementTimeout);
  searchUsbInterval && clearInterval(searchUsbInterval);
  log(3, "Stop Measure");

  // Closing the port
  if (port) {
    
    setTimeout(() => {
      if(port){
        try {
          sendCommand(commands[DeviceOff]);    
          log(3, "Closing Port");
          setTimeout(() => {
            port && port.isOpen && port.close();
            port = undefined;            
          }, 200);
        } catch (error) {
          log(1, "Closing port ", error);
        }
      }
     }, 500);

  } else {
    clearInterval(searchUsbInterval);
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 550,
    height: 550,
    x:825,
    y:400,
    transparent: true,        // Transparent background
    frame: false,             // No window frame/border
    alwaysOnTop: true,        // Keep window on top (optional)
    resizable: false,         // Prevent resizing
    skipTaskbar: true,       // Show in taskbar (set to true to hide)
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  // Remove menu
  mainWindow.setMenu(null);

  // Load the segmented version HTML
  mainWindow.loadFile('src/index.html');

  // Open DevTools for debugging (comment out for production)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  mainWindow.hide();
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  registerCallback((payload) => {
    if(!payload) return;

    if(payload.message === "app_hide"){
      mainWindow.hide();
      return;
    }

    if(payload.message === "app_show"){
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      mainWindow.moveTop();
      mainWindow.focus();
    }

    if(mainWindow){
      mainWindow.webContents.send('kforce-data', payload);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
