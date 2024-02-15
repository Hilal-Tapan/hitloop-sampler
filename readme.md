# Drama
This project records and plays back audio. After recording, any recording can be sent to an endpoint of your choice. 
In this case the endpoint is a POST /upload (Line 49 in entry-client.js), but this can be changed to anything else.

## Installation
1. Clone the repository
2. Run `npm install`

## Usage
1. Run `npm dev` for the development server
2. Go to `https://localhost:5173` in your browser to see the project running
3. NOTE!: Microphone only works on HTTPS, so you need to run the project on HTTPS. Otherwise, there will be no microphone permission prompt.
