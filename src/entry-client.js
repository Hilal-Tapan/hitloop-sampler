import '@picocss/pico'
import './style.css'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js'

import {pipeline, env} from '@xenova/transformers'

let wavesurfer, record, wavUrl; // Define wavUrl here
let scrollingWaveform = true
env.allowLocalModels = false
env.allowRemoteModels = true

const createWaveSurfer = async () => {
    async function convertBlob(blob) {
        let audioBuffer = await blob.arrayBuffer();
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let audioBufferSource = audioCtx.createBufferSource();

        // Decode the audio data
        let decodedBuffer = await audioCtx.decodeAudioData(audioBuffer);

        // Interleave the channels
        let interleavedData = new Float32Array(decodedBuffer.length * decodedBuffer.numberOfChannels);
        let offset = 0;

        for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
            let channelData = decodedBuffer.getChannelData(i);

            for (let j = 0; j < decodedBuffer.length; j++) {
                interleavedData[offset] = channelData[j];
                offset++;
            }
        }

        // Create a new AudioBuffer with interleaved data
        let interleavedBuffer = audioCtx.createBuffer(decodedBuffer.numberOfChannels, decodedBuffer.length, audioCtx.sampleRate);

        for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
            interleavedBuffer.copyToChannel(interleavedData.subarray(i * decodedBuffer.length, (i + 1) * decodedBuffer.length), i);
        }

        // Create a new Blob from the interleaved AudioBuffer
        let blobWithWavHeader = await audioCtx.createWAVBlob(interleavedBuffer);

        return blobWithWavHeader;
    }

    // Extend the AudioContext prototype to create a WAV Blob
    AudioContext.prototype.createWAVBlob = function (audioBuffer) {
        return new Promise((resolve) => {
            const audioData = audioBuffer.getChannelData(0);
            const buffer = new ArrayBuffer(44 + audioData.length * 2);
            const view = new DataView(buffer);

            writeString(view, 0, 'RIFF');
            view.setUint32(4, 32 + audioData.length * 2, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, this.sampleRate, true);
            view.setUint32(28, this.sampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeString(view, 36, 'data');
            view.setUint32(40, audioData.length * 2, true);

            // Write the PCM audio data
            for (let i = 0; i < audioData.length; i++) {
                view.setInt16(44 + i * 2, audioData[i] * 32767, true);
            }

            resolve(new Blob([buffer], {type: 'audio/wav'}));

            function writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            }
        });
    };

    // Create an instance of WaveSurfer
    if (wavesurfer) {
        wavesurfer.destroy()
    }
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: 'rgb(207, 248, 185)',
        progressColor: 'rgb(100, 0, 100)',
    })

    // Initialize the Record plugin
    record = wavesurfer.registerPlugin(RecordPlugin.create({
        scrollingWaveform,
        renderRecordedAudio: false,
    }))

    // Render recorded audio
    record.on('record-end', async (blob) => {
        const container = document.querySelector('#recordings')
        const recordedUrl = URL.createObjectURL(blob)

        // Create wavesurfer from the recorded audio
        // container recordings div erover en dan absolute dan gaat die niet verplaatsen
        const wavesurfer = WaveSurfer.create({
            container,
            waveColor: 'rgb(200, 100, 0)',
            progressColor: 'rgb(100, 50, 0)',
            url: recordedUrl,
        })

        const modelSelect = document.createElement('select');
        modelSelect.id = 'model-select';
        modelSelect.name = 'model-select';
        modelSelect.innerHTML = `
        <option value="tiny">Whisper Tiny</option>
        <option value="base">Whisper Base</option>
        <option value="small">Whisper Small</option>
        <option value="medium">Whisper Medium (Slow!)</option>
        <option value="large" selected>Whisper Large</option>
           `
        container.appendChild(modelSelect);


        // Upload link
        const link = container.appendChild(document.createElement('button'))
        link.id = 'uploadButton'
        link.innerHTML = '<img src="images/play-button.svg" alt="Play Recording">';
        link.classList.add('play-button');

        let data = new FormData();
        let convertedBlob = await convertBlob(blob);
        wavUrl = URL.createObjectURL(convertedBlob); // Assign wavUrl here
        data.append('file', convertedBlob);

        link.addEventListener('click', async (e) => {
            const model = document.getElementById('model-select').value;
            document.getElementById("spinner").style.display = 'block';

            if (model === 'large') {
                // do post to example endpoint
                fetch('/transcribe', {
                    method: 'POST',
                    body: data,
                    mode: 'no-cors'
                }).then(response => response.json())
                    .then(data => {
                        wavesurfer.playPause()
                        document.getElementById("output").innerText += `Whisper-large: ${data.text} \n`
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                    });
            } else {
                const transcriber = await pipeline('automatic-speech-recognition', `Xenova/whisper-${model}`);
                const result = await transcriber(wavUrl);
                console.log(result)
                document.getElementById("output").innerText += `Whisper-${model}: ${result.text} \n`
            }

            document.getElementById("spinner").style.display = 'none';
        });
    })

    // Add this code snippet where you want to create the buttons for each model
    const modelButtonsContainer = document.querySelector('#model-buttons');

    ['tiny', 'base', 'small', 'medium'].forEach(model => {
        const button = document.createElement('button');
        button.textContent = `Whisper ${model.charAt(0).toUpperCase() + model.slice(1)}`;
        button.addEventListener('click', async () => {
            document.getElementById("spinner").style.display = 'block';

            const transcriber = await pipeline('automatic-speech-recognition', `Xenova/whisper-${model}`);
            const result = await transcriber(wavUrl);
            console.log(result);
            document.getElementById("output").innerText += `Whisper-${model}: ${result.text} \n`;

            document.getElementById("spinner").style.display = 'none';
        });
        modelButtonsContainer.appendChild(button);
    });
}

// const pauseButton = document.querySelector('#pause')
// pauseButton.onclick = () => {
//     if (record.isPaused()) {
//         record.resumeRecording()
//         pauseButton.textContent = 'Pause'
//         return
//     }

//     record.pauseRecording()
//     pauseButton.textContent = 'Resume'
// }

const micSelect = document.querySelector('#mic-select')
{
    // Mic selection
    RecordPlugin.getAvailableAudioDevices().then((devices) => {
        devices.forEach((device) => {
            const option = document.createElement('option')
            option.value = device.deviceId
            option.text = device.label || device.deviceId
            micSelect.appendChild(option)
        })
    })
}

// Record button
const recButton = document.querySelector('#record')

recButton.onclick = () => {
    if (record.isRecording()) {
        record.stopRecording()
        // recButton.textContent = 'Record'
        // pauseButton.style.display = 'none'
        // record button disabelen nadat ze op stop klikken, eventueel refresh knop voor als ze nieuwe opnamen willen.
        return
    }

    recButton.disabled = true

    // reset the wavesurfer instance

    // get selected device
    const deviceId = micSelect.value
    record.startRecording({deviceId}).then(() => {
        recButton.innerHTML = '<img src="images/pause-button.svg" alt="Stop Recording">';
        recButton.disabled = false
        // pauseButton.style.display = 'inline'
    })
}

createWaveSurfer()



// import '@picocss/pico';
// import './style.css';
// import WaveSurfer from 'wavesurfer.js';
// import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js';
// import { pipeline, env } from '@xenova/transformers';

// let wavesurfer, record;
// let scrollingWaveform = true;
// env.allowLocalModels = false;
// env.allowRemoteModels = true;

// const createWaveSurfer = async () => {
//     // Function to convert Blob
//     async function convertBlob(blob) {
//         // Implementation of the convertBlob function...
//     }

//     // Destroy existing WaveSurfer instance if any
//     if (wavesurfer) {
//         wavesurfer.destroy();
//     }
//     // Create new WaveSurfer instance
//     wavesurfer = WaveSurfer.create({
//         container: '#waveform',
//         waveColor: 'rgb(207, 248, 185)',
//         progressColor: 'rgb(100, 0, 100)',
//     });

//     // Register RecordPlugin
//     record = wavesurfer.registerPlugin(RecordPlugin.create({
//         scrollingWaveform,
//         renderRecordedAudio: false,
//     }));

//     // Event listener for record-end event
//     record.on('record-end', async (blob) => {
//         const container = document.querySelector('#recordings');
//         const recordedUrl = URL.createObjectURL(blob);

//         const wavesurfer = WaveSurfer.create({
//             container,
//             waveColor: 'rgb(200, 100, 0)',
//             progressColor: 'rgb(100, 50, 0)',
//             url: recordedUrl,
//         });

//         // Dropdown select for model
//         const modelSelect = document.createElement('select');
//         modelSelect.id = 'model-select';
//         modelSelect.name = 'model-select';
//         modelSelect.innerHTML = `
//             <option value="tiny">Whisper Tiny</option>
//             <option value="base">Whisper Base</option>
//             <option value="small">Whisper Small</option>
//             <option value="medium">Whisper Medium (Slow!)</option>
//             <option value="large" selected>Whisper Large</option>
//         `;
//         container.appendChild(modelSelect);

//         // Button to play recording
//         const link = container.appendChild(document.createElement('button'));
//         link.id = 'uploadButton';
//         link.innerHTML = '<img src="images/play-button.svg" alt="Play Recording">';
//         link.classList.add('play-button');

//         // Prepare data for transcription
//         let data = new FormData();
//         let convertedBlob = await convertBlob(blob);
//         let wavUrl = URL.createObjectURL(convertedBlob);
//         data.append('file', convertedBlob);

//         // Event listener for transcription button click
// // Event listener for transcription button click
// link.addEventListener('click', async (e) => {
//     const model = document.getElementById('model-select').value;
//     document.getElementById("spinner").style.display = 'block';

//     if (model === 'large') {
//         fetch('/transcribe', {
//             method: 'POST',
//             body: data,
//             mode: 'no-cors'
//         }).then(response => response.json())
//             .then(data => {
//                 // Check if the selected model is Whisper-large
//                 if (model === 'large') {
//                     wavesurfer.playPause(); // Only play the audio if the selected model is Whisper-large
//                 }
//                 document.getElementById("output").innerText += `Whisper-large: ${data.text} \n`;
//             })
//             .catch((error) => {
//                 console.error('Error:', error);
//             });
//     } else {
//         const transcriber = await pipeline('automatic-speech-recognition', `Xenova/whisper-${model}`);
//         const result = await transcriber(wavUrl);
//         console.log(result);
//         document.getElementById("output").innerText += `Whisper-${model}: ${result.text} \n`;
//     }

//     document.getElementById("spinner").style.display = 'none';
// });

//     });
// };

// // Select microphone dropdown population
// const micSelect = document.querySelector('#mic-select');
// RecordPlugin.getAvailableAudioDevices().then((devices) => {
//     devices.forEach((device) => {
//         const option = document.createElement('option');
//         option.value = device.deviceId;
//         option.text = device.label || device.deviceId;
//         micSelect.appendChild(option);
//     });
// });

// // Record button click handler
// const recButton = document.querySelector('#record');
// recButton.onclick = () => {
//     if (record.isRecording()) {
//         record.stopRecording();
//         return;
//     }
//     recButton.disabled = true;
//     const deviceId = micSelect.value;
//     record.startRecording({ deviceId }).then(() => {
//         recButton.innerHTML = '<img src="images/pause-button.svg" alt="Stop Recording">';
//         recButton.disabled = false;
//     });
// };

// // Initialize WaveSurfer
// createWaveSurfer();

// // Container for transcription buttons
// const container = document.querySelector('#recordings');

// // Function to add transcription button for each model
// const addTranscriptionButton = (modelName) => {
//     const button = document.createElement('button');
//     button.innerText = `Transcribe with Whisper ${modelName}`;
//     button.classList.add('transcription-button');
//     button.addEventListener('click', async () => {
//         document.getElementById("spinner").style.display = 'block';
//         const transcriber = await pipeline('automatic-speech-recognition', `Xenova/whisper-${modelName}`);
//         const result = await transcriber(wavUrl);
//         console.log(result);
//         document.getElementById("output").innerText += `Whisper-${modelName}: ${result.text} \n`;
//         document.getElementById("spinner").style.display = 'none';
//     });
//     container.appendChild(button);
// };

// // Add transcription buttons for each model
// ['Tiny', 'Base', 'Small', 'Medium (Slow!)'].forEach(modelName => {
//     addTranscriptionButton(modelName);
// });

