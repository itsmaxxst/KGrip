# Project Setup Instructions (check it in code mode or raw version for readability)

For this to work you have to follow the file structure exactly as shown below.

## Package.json dependencies (check electron documentation on how to structure it for your build)

 - big.js
 - serialPort
 - zeromq
 - electron

## Required File Structure

project-root/
│
├── main.js
├── queue.js
├── temp.json
├── config.json
├── debug.log (create this as an empty file – it will populate with debug logs)
│
└── src/
      ├── gauge-segmented.js
      ├── renderer-segmented.js
      ├── index.html
      └── fonts/ (optional)
            └── *.ttf

## Important Notes

### 1. `debug.log`
Create an empty `debug.log` file in the root directory.  
It will automatically populate with debug logs during runtime.

### 2. Fonts (Optional)
You may add a `fonts` folder inside the `src` directory.  
This folder should contain `.ttf` font files if custom fonts are needed.

## Test Application Requirement

You must create a **test application** based on this project.

### Purpose

The test application should:

- Send messages via **ZeroMQ**
- Use the **same address** as the main application
- Communicate with the device/plugin

### Messages to Send

The test app must send the following messages:

- `measureStart`
- `measureSamplingOn`
- `measureStop`

### Communication Flow

- The test project communicates with the plugin
- The plugin responds with messages back to the test app
- This simulates a **front-end emulation**

You are free to implement this test project however you prefer, depending on your goal and architecture.

## Summary

✔ Follow the exact folder structure  
✔ Create an empty `debug.log` file  
✔ Optional `fonts` folder inside `src`  
✔ Implement a ZeroMQ test app that sends:
- `measureStart`
- `measureSamplingOn`
- `measureStop`  

✔ Ensure bidirectional communication with the plugin (front-end emulation)

