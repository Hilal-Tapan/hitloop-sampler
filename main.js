import 'modern-normalize'
import '@picocss/pico'
import './style.css'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js'
import mediaRecorder from 'wavesurfer.js/src/webaudio/recorder.js'

let wavesurfer, record
let scrollingWaveform = true

const createWaveSurfer = (stream) => {
    // Create an instance of WaveSurfer
    if (wavesurfer) {
        wavesurfer.destroy()
    }
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: 'rgb(200, 0, 200)',
        progressColor: 'rgb(100, 0, 100)',
    })

    // Initialize the Record plugin
    let chunks = []
    let record = new MediaRecorder(stream);
    record.ondataavailable = (e) => {
        chunks.push(e.data);
    }

    // Render recorded audio
    record.onstop = event => {
        console.log('Recording stopped: ', event);
        const container = document.querySelector('#recordings')
        let blob = new Blob(chunks, {type: record.mimeType});
        chunks = [];
        const recordedUrl = URL.createObjectURL(blob)

        let formData = new FormData();
        formData.append('file', blob);

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
        wavesurfer.on('pause', () => (button.textContent = 'Play'))
        wavesurfer.on('play', () => (button.textContent = 'Pause'))

        // Download link
        const link = container.appendChild(document.createElement('button'))
        link.textContent = 'Send to Server'
        link.addEventListener('click', async (e) => {
            // do post to example endpoint
            alert('Sending to /upload endpoint! Not inmplemented yet.')
            await fetch(`http://127.0.0.1:5000/upload`, {
                method: 'POST',
                body: formData,
                headers: { 'Content-Type': 'audio/wav' },
            })
                .then((res) => res.json())
                .then((res) => {
                    console.log(res)
                    link.href = res.url
                    link.download = res.name
                })
        });
    }
    pauseButton.style.display = 'none'
}

const pauseButton = document.querySelector('#pause')
pauseButton.onclick = () => {
    if (record.isPaused()) {
        record.resumeRecording()
        pauseButton.textContent = 'Pause'
        return
    }

    record.pauseRecording()
    pauseButton.textContent = 'Resume'
}

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
        pauseButton.style.display = 'none'
        return
    }

    recButton.disabled = true

    // reset the wavesurfer instance

    // get selected device
    const deviceId = micSelect.value
    record.startRecording({ deviceId }).then(() => {
        recButton.textContent = 'Stop'
        recButton.disabled = false
        pauseButton.style.display = 'inline'
    })
}

createWaveSurfer()