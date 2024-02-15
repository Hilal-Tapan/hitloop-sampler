import fs from 'node:fs/promises'
import express from 'express'
import axios from 'axios'
import multer from 'multer'
import dotenv from 'dotenv'

dotenv.config()


// Constants
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 5173
const base = process.env.BASE || '/'
const upload = multer()

// Cached production assets
const templateHtml = isProduction
    ? await fs.readFile('./dist/client/index.html', 'utf-8')
    : ''
const ssrManifest = isProduction
    ? await fs.readFile('./dist/client/.vite/ssr-manifest.json', 'utf-8')
    : undefined

// Create http server
const app = express()

// Add Vite or respective production middlewares
let vite
if (!isProduction) {
    const {createServer} = await import('vite')
    vite = await createServer({
        server: {middlewareMode: true},
        appType: 'custom',
        base
    })
    app.use(vite.middlewares)
} else {
    const compression = (await import('compression')).default
    const sirv = (await import('sirv')).default
    app.use(compression())
    app.use(base, sirv('./dist/client', {extensions: []}))
}

app.post('/transcribe', upload.single('file'), async (req, res) => {
    const formData = new FormData()
    formData.append('file', new Blob([req.file.buffer], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', 'whisper-1')
    formData.append('language', 'nl')
    const response = await axios.post(process.env.ENDPOINT,
        formData,
        {
            headers: {
                'Authorization': `Bearer ${process.env.KEY}`,
                'Content-Type': 'multipart/form-data'
            }})

    res.status(200).json(response.data)
});

// Serve HTML
app.use('/', async (req, res) => {
    let url = req.originalUrl
    let template = await fs.readFile('./index.html', 'utf-8')
    template = await vite.transformIndexHtml(url, template)
    res.status(200).set({'Content-Type': 'text/html'}).send(template)
})

// Start http server
app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`)
})