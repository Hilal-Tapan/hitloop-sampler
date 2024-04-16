

import '@picocss/pico'
import './style.css'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js'

import {pipeline, env} from '@xenova/transformers'

let wavesurfer, record
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
        const wavesurfer = WaveSurfer.create({
            container,
            waveColor: 'rgb(200, 100, 0)',
            progressColor: 'rgb(100, 50, 0)',
            url: recordedUrl,
        })

        // Play button
        const button = container.appendChild(document.createElement('button'))
        button.textContent = 'Play'
        button.onclick = () => wavesurfer.playPause()
        // wavesurfer.on('pause', () => (button.textContent = 'Play'))
        // wavesurfer.on('play', () => (button.textContent = 'Pause'))


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
        link.textContent = 'Generate'

        let data = new FormData();
        let convertedBlob = await convertBlob(blob);
        let wavUrl = URL.createObjectURL(convertedBlob);
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
    // pauseButton.style.display = 'none'
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
        recButton.textContent = 'Record'
        // pauseButton.style.display = 'none'
        // record button disabelen nadat ze op stop klikken, eventueel refresh knop voor als ze nieuwe opnamen willen.
        return
    }

    recButton.disabled = true

    // reset the wavesurfer instance

    // get selected device
    const deviceId = micSelect.value
    record.startRecording({deviceId}).then(() => {
        recButton.textContent = 'Stop'
        recButton.disabled = false
        // pauseButton.style.display = 'inline'
    })
}

createWaveSurfer()