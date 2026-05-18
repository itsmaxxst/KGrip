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

const JobQueue = require('./lib/queue');
const { loadConfig }  = require('./lib/config');
const Logger          = require('./lib/logger');


// Definitions
const dealer = new zeromq.Dealer();
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
let baselineSetted = false;
let num = 0;
let weight = 0;
let weightMax = 0;
let weightArray = [];
let durationSent = false;
let parserCount = 0;
let parser = null;

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
  logger.debug(`a Job added: ${job.id} (${job.type})`);
});
queue.on('job:start', (job) => {
  logger.debug(`p Processing: ${job.id} (attempt ${job.attempts})`);
});
queue.on('job:completed', (job, result) => {
  logger.debug(`c Completed: ${job.id} - Result: ${result}`);
});
queue.on('job:failed', (job, error) => {
  logger.debug(`x Failed: ${job.id} - ${error.message}`);
});
queue.on('job:retry', (job) => {
  logger.debug(`r Retrying: ${job.id} (attempt ${job.attempts})`);
});
queue.process('zeromqSendMessage', 
  // Your async work here
  async (data) => {
    await new Promise((resolve, reject) => {
      // Call the async operation and resolve/reject when it finishes
      dealer.send(data.message)
        .then(() => { // success -> resolve the outer promise
          logger.debug(`---> Sent message ${data.message}`)
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

const messages = [ 'measure_received'];

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
    resetState();
  }

  weightMax = 0;
  startTimeoutMeasurement = false;
  weightArray.length = 0;
  measureStarted = false;

}

/**
 * sendCommand
 * @param {*} command 
 */
function sendCommand(command) {
  port &&
    port.write(command[commandCode], (err) => {
      if (err) {
        logger.error(`Error on send command: ${err.message}`);
        return endAlgorithm(3);
      }
      logger.info( `command sent: ${command[commandDesc]}`);
    });
  if(!port) {
    logger.error(`Port Not Opened ${command}`);
  }
}


let config;
try { config = loadConfig(process.argv || 'config.json'); }
catch (err) { process.stderr.write(`[FATAL] ${err.message}\n`); process.exit(1); }

// - 2. Logger ----
const logger = new Logger({ 
                logDir: config.log.logDir,
                logName: config.log.logName, 
                level: config.log.level ,
                rotate: config.log.rotate,
                maxBytes: config.log.maxBytes,
                maxFiles: config.log.maxFiles,
                console: config.log.console });
logger.info('KForceGripGUI plugin starting');


const endpoint = "tcp://" + config.socket.zeromqIp + ":" + config.socket.zeromqPort;

// dealer zeroMq listener msg from POD
async function listenZmq() {
  for await (const [msg] of dealer) {
    try {
      const message = JSON.parse(msg.toString());

      logger.info( ` > zmq received: ${message.inputData.cmd}`);

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
          emitMessage({ message: "app_show", range: message.inputData.range });
          break;

        case "measureSetting":
          KGrip(socketPath);
          break;
        
        case "showGauge":
          emitMessage({ message: "show_gauge" });
          break;

        case "hideGauge":
          emitMessage({ message: "hide_gauge" });
          break;
      }

    } catch (err) {
      logger.error(` > zmq received : ${err}`);
    }
  }
}

// dealer zeroMq bind
async function initZmq() {
  try {
    await dealer.bind(endpoint);
    logger.info( `ZeroMQ bind on endpoint: ${endpoint}`);
    listenZmq(); 
  } catch (error) {
    logger.error(`ZeroMQ socket problem: ${error}`);
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
  if ( !messages.includes(payload.message) ){
    zeromqSendMessage(JSON.stringify({ outputData: payload }));
    logger.info(` < zmq sent: ${payload.message}`);
  }
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
    logger.error("Timeout, nobody showed up");
    emitMessage({ message: "timeout" });
    return endAlgorithm(6);
  }, config.timeout); // 1/2 minute to general timeout + 5 seconds of start measurement

  logger.info( "Searching K-Grip...");
  if (!port) {
    searchUsbInterval = setInterval(() => {
      logger.debug(".");
      SerialPort.list()
        .then((data) => {
          data.some((device) => {
            //console.log(device)
            if (
              device.productId == config.port.productId &&
              device.vendorId == config.port.vendorId
            ) {
              socketPath = device.path;
              logger.info( `Found it on path: ${socketPath}`);
              logger.info( "wait to set baseline");
              clearInterval(searchUsbInterval);
              emitMessage({ message: "device_found" });
            }
          });
        })
        .catch((error) => {
          logger.error(error);
          endAlgorithm(5);
        });
      }, 1000);
  } else if (port.isOpen){
    emitMessage({ message: "device_found" });
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
  
    port.on('error', error => logger.error(error))
  
    port.on('open', () =>{
      logger.info( "Connected");
      // Send Coef reading message
      sendCommand(commands[SamplingOff]);
      sendCommand(commands[GetCoef]);
      setTimeout(() => {
        // Setting parser trigger event on ByteLength 11
        parser = port.pipe(new ByteLengthParser({ length: 11 }));
        parser.on("data", checkResponse);
        // Sampling=On
        sendCommand(commands[SamplingOn]);
        stopMeasurement = false;
        }, config.samplingDelay);
      }
    )

    port.on('close', () => {
      parser = null;
    });
    
    port.on("data", (data) => {
      if (data.length === 6) {
        // Reading the Coef
        coef = data.toString() / 1000000;
        logger.info(`Coef: ${coef}`);
      }
    });
  } else if (port.isOpen){
    logger.error("Error: port already opened, wrong flow")
    sendCommand(commands[DeviceOff]);
    logger.error(`Error: Closing Port ${port.path}`);
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
        logger.info(`Potential Baseline: ${value}, ${config.baseline}`);

        timeoutForCancelSamplingTimeout = undefined;
        logger.info("start timeout for start sampling");
        timeoutForStartSampling = setTimeout(() => {
          baselineSetted = true;
          // Set the baseline only if num > config.baseline
          baseline = value;
          num = value;
          //console.log('Baseline: ', baseline)
          first = false;
          logger.info(`baseline ok, start measure : ${baseline}`);
          weightMax = 0;
          emitMessage({ message: "baseline_ok"});
        }, config.baselineTimeSetting);
      }
      // if the value is below the baseline threshold:
      // - clear the eventual previsous timeout
      // - start a timer to cancel the above timer. If a value bigger than config.baseline
      // is detected within 500ms, this timer will be cancelled
      else if (value < config.baseline && !timeoutForCancelSamplingTimeout && !baselineSetted) {
        clearTimeout(timeoutForCancelSamplingTimeout);
        timeoutForCancelSamplingTimeout = setTimeout(() => {
          clearTimeout(timeoutForStartSampling);
          logger.info("baseline_stop");
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
        // trigger start if weight > 1.8 value
        if (!startTimeoutMeasurement && weight > config.trigger && !stopMeasurement) {
          logger.info("Start Measurement");
          startTimeoutMeasurement = true;
          durationSent = false;

          clearTimeout(algorithmTimeout);
          measurementTimeout = setTimeout(() => {
              // set a 5 sec timeout for the measurement duration
              stopMeasurement = true;
              logger.info("Stop Measurement");
              sendCommand(commands[SamplingOff]);
              errorFlag = "00";
              checkError(errorFlag, (error, errorMessage) => {
                if (error) return endAlgorithm(error, errorMessage);
                tempFile.outputData.weightMax = weightMax.toFixed(1);
                tempFile.outputData.weightArray = JSON.stringify(weightArray);
                tempFile.outputData.weightMedia = (
                  weightArray.reduce((a, b) => a + b, 0) / weightArray.length
                ).toFixed(1);
                // Showing results
                logger.info(` -- Baseline: ${baseline}`);
                logger.info(` -- Coef: ${coef}`);
                logger.info(` -- Num measures: ${weightArray.length}`);
                logger.info(` -- WeightMax: ${tempFile.outputData.weightMax}, Kg`);
                logger.info(` -- WeightAVG: ${tempFile.outputData.weightMedia}, Kg`);

                emitMessage({
                  message: "measure_finish",
                  rawMeasures: tempFile.outputData.weightArray,
                  avg: tempFile.outputData.weightMedia,
                  max: tempFile.outputData.weightMax,
                });
                return endAlgorithm();
              });
          }, config.duration);
        }
        if (weight < config.ceilWeight && startTimeoutMeasurement && !stopMeasurement) {
          // take the weight value if valid (less than < config.ceilWeight) and if measurement is running
          if (weight > weightMax) {
            // updating weightMax
            weightMax = weight;
          }
          weightArray.push(weight);
          if(!durationSent){
            emitMessage({ message: "measure_received", value: weight.toFixed(1), duration: config.duration});
            durationSent = true;
          } else {
            emitMessage({ message: "measure_received", value: weight.toFixed(1)});
          }
          logger.debug(`Weight: ${weight.toFixed(1)},  - WeightMax: ${weightMax.toFixed(1)}`);
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
    logger.error("timeout during measureSamplingOn");
    emitMessage({ message: "timeout" });
    endAlgorithm(6);
  },config.timeout);

  emitMessage({ message: "measureSamplingOn"});
  sendCommand(commands[SamplingOn]);
  stopMeasurement = false;
}

/**
 * stopMeasure
 */
function stopMeasure() {

  logger.info("Stop Measure");
  resetState();

  // Closing the port
  if (port) {
    
    setTimeout(() => {
      if(port){
        try {
          sendCommand(commands[DeviceOff]);  
          logger.info("Closing Port");
          setTimeout(() => {
            port && port.isOpen && port.close();
            port = undefined;            
          }, 200);
        } catch (error) {
          logger.error(`Closing port ${error}`);
        }
      }
     }, 500);

  } else {
    clearInterval(searchUsbInterval);
  }
}

/**
 * resetState
 */
function resetState() {
  logger.info("Resetting states to initial values");

  clearTimeout(algorithmTimeout);
  clearTimeout(timeoutForStartSampling);
  clearTimeout(timeoutForCancelSamplingTimeout);
  clearTimeout(measurementTimeout);
  clearInterval(searchUsbInterval);

  measureStarted = false;
  durationSent = false;
  coef = 0;
  first = true;
  startTimeoutMeasurement = false;
  stopMeasurement = false;
  baseline = 0;
  baselineSetted = false;
  num = 0;
  weight = 0;
  weightMax = 0;
  weightArray = [];

  timeoutForStartSampling = undefined;
  timeoutForCancelSamplingTimeout = undefined;
  searchUsbInterval = undefined;
  measurementTimeout = undefined;
  algorithmTimeout = undefined;

  tempFile = {
    hardware: "KForceGrip",
    inputData: {},
    outputData: {},
    messages: [],
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 550,
    height: 550,
    x: config.screenOffset.x,
    y: config.screenOffset.y,
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

    if(payload.message === "app_hide" || payload.message === "timeout"){
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
