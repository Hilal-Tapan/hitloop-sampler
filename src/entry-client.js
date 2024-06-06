// Importeer CSS-stijlen en benodigde bibliotheken
import '@picocss/pico'
import './style.css'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js'

import { pipeline, env } from '@xenova/transformers'

// Globale variabelen declareren
let wavesurfer, record, wavUrl;
let scrollingWaveform = true;

// Configureer omgeving voor modelgebruik
env.allowLocalModels = false;
env.allowRemoteModels = true;

// Functie om WaveSurfer aan te maken en in te stellen
const createWaveSurfer = async () => {

    // Functie om een Blob om te zetten naar een WAV-bestand
    async function convertBlob(blob) {
        let audioBuffer = await blob.arrayBuffer(); // Zet Blob om naar ArrayBuffer
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)(); // Maak AudioContext aan
        let decodedBuffer = await audioCtx.decodeAudioData(audioBuffer); // Decodeer audiogegevens

        // Maak een nieuwe buffer met de audio data
        let interleavedData = new Float32Array(decodedBuffer.length * decodedBuffer.numberOfChannels);
        let offset = 0;

        for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
            let channelData = decodedBuffer.getChannelData(i);

            for (let j = 0; j < decodedBuffer.length; j++) {
                interleavedData[offset] = channelData[j];
                offset++;
            }
        }

        let interleavedBuffer = audioCtx.createBuffer(decodedBuffer.numberOfChannels, decodedBuffer.length, audioCtx.sampleRate);
        for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
            interleavedBuffer.copyToChannel(interleavedData.subarray(i * decodedBuffer.length, (i + 1) * decodedBuffer.length), i);
        }

        // Maak een WAV-bestand van de buffer
        let blobWithWavHeader = await audioCtx.createWAVBlob(interleavedBuffer);
        return blobWithWavHeader;
    }

    // Voeg een functie toe aan AudioContext om een WAV-bestand te maken
    AudioContext.prototype.createWAVBlob = function (audioBuffer) {
        return new Promise((resolve) => {
            const audioData = audioBuffer.getChannelData(0);
            const buffer = new ArrayBuffer(44 + audioData.length * 2);
            const view = new DataView(buffer);

            // Schrijf de WAV-header
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

            // Schrijf de audio data
            for (let i = 0; i < audioData.length; i++) {
                view.setInt16(44 + i * 2, audioData[i] * 32767, true);
            }

            // Maak een Blob van de buffer en geef deze terug
            resolve(new Blob([buffer], { type: 'audio/wav' }));

            // Hulpfunctie om een string in de DataView te schrijven
            function writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            }
        });
    };

    // Vernietig bestaande WaveSurfer instantie als deze bestaat
    if (wavesurfer) {
        wavesurfer.destroy();
    }

    // Maak een nieuwe WaveSurfer instantie
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: 'rgb(207, 248, 185)',
        progressColor: 'rgb(100, 0, 100)',
    });

    // Installeer en configureer het opname-plugin
    record = wavesurfer.registerPlugin(RecordPlugin.create({
        scrollingWaveform,
        renderRecordedAudio: false,
    }));

    // Wat te doen als de opname stopt
    record.on('record-end', async (blob) => {
        const container = document.querySelector('#recordings');
        const recordedUrl = URL.createObjectURL(blob);

        // Maak een nieuwe WaveSurfer instantie voor de opname
        const wavesurfer = WaveSurfer.create({
            container,
            waveColor: 'rgb(200, 100, 0)',
            progressColor: 'rgb(100, 50, 0)',
            url: recordedUrl,
        });

        // Voeg een modelkeuzelijst toe
        const modelSelect = document.createElement('select');
        modelSelect.id = 'model-select';
        modelSelect.name = 'model-select';
        modelSelect.innerHTML = `
        <option value="tiny">Whisper Tiny</option>
        <option value="base">Whisper Base</option>
        <option value="small">Whisper Small</option>
        <option value="medium">Whisper Medium (Slow!)</option>
        <option value="large" selected>Whisper Large</option>
        `;
        container.appendChild(modelSelect);

        // Voeg een afspeelknop toe
        const link = container.appendChild(document.createElement('button'));
        link.id = 'uploadButton';
        link.innerHTML = '<img src="images/play-button.svg" alt="Play Recording">';
        link.classList.add('play-button');

        // Zet de opgenomen blob om naar WAV en bereid de gegevens voor
        let data = new FormData();
        let convertedBlob = await convertBlob(blob);
        wavUrl = URL.createObjectURL(convertedBlob);
        data.append('file', convertedBlob);

        // Wat te doen als de afspeelknop wordt ingedrukt
        link.addEventListener('click', async (e) => {
            const model = document.getElementById('model-select').value;
            document.getElementById("spinner").style.display = 'block';

            // Gebruik verschillende transcriptiemethoden op basis van het gekozen model
            if (model === 'large') {
                fetch('/transcribe', {
                    method: 'POST',
                    body: data,
                    mode: 'no-cors'
                }).then(response => response.json())
                    .then(data => {
                        wavesurfer.playPause();
                        document.getElementById("output").innerHTML += `<div class="transcription-label">Large:</div><div class="transcription">${data.text}</div>`;
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                    });
            } else {
                const transcriber = await pipeline('automatic-speech-recognition', `Xenova/${model}`);
                const result = await transcriber(wavUrl);
                console.log(result);
                document.getElementById("output").innerText += `${model}: ${result.text} \n`;
            }

            document.getElementById("spinner").style.display = 'none';
        });
    });

    // Maak knoppen aan voor snelle transcriptie
    const modelButtonsContainer = document.querySelector('#model-buttons');
    ['Tiny', 'Base', 'Small', 'Medium'].forEach(model => {
        const button = document.createElement('button');
        button.textContent = `${model.charAt(0).toUpperCase() + model.slice(1)}`;
        button.addEventListener('click', async () => {
            document.getElementById("spinner").style.display = 'block';

            const transcriber = await pipeline('automatic-speech-recognition', `Xenova/whisper-${model}`);
            const result = await transcriber(wavUrl);
            console.log(result);
            document.getElementById("output").innerHTML += `<div class="transcription-label">${model}:</div><div class="transcription">${result.text}</div>`;

            document.getElementById("spinner").style.display = 'none';
        });
        modelButtonsContainer.appendChild(button);
    });
};

// Vul de microfoonselectie in met beschikbare audiodevices
const micSelect = document.querySelector('#mic-select');
{
    RecordPlugin.getAvailableAudioDevices().then((devices) => {
        devices.forEach((device) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || device.deviceId;
            micSelect.appendChild(option);
        });
    });
}

// Wat te doen als de opnameknop wordt ingedrukt
const recButton = document.querySelector('#record');
recButton.onclick = () => {
    if (record.isRecording()) {
        record.stopRecording();
        return;
    }

    recButton.disabled = true;

    const deviceId = micSelect.value;
    record.startRecording({ deviceId }).then(() => {
        recButton.innerHTML = '<img src="images/pause-button.svg" alt="Stop Recording">';
        recButton.disabled = false;
    });
}

// WaveSurfer initialiseren
createWaveSurfer();
