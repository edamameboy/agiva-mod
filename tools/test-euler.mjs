import 'dotenv/config';
import { WebcastEventEmitter, createWebSocketUrl } from '@eulerstream/euler-websocket-sdk';
import WebSocket from 'ws';

const key = process.env.EULERSTREAM_API_KEY || '';
if (!key) {
    console.error('Missing EULERSTREAM_API_KEY in .env');
    process.exit(1);
}
const url = createWebSocketUrl({ uniqueId: 'officialgeilegisela', apiKey: key, baseUrl: 'wss://ws.eulerstream.com' });
console.log('Connecting to', url);

const ws = new WebSocket(url);
const emitter = new WebcastEventEmitter();

ws.on('message', (d) => {
    const data = JSON.parse(d.toString());
    if (data.messages) {
        for(const msg of data.messages) {
            emitter.emit(msg.type, msg.data);
            if (msg.type === 'WebcastChatMessage') {
                console.log('Chat:', msg.data.user.uniqueId, '->', msg.data.comment);
            }
        }
    }
});
setTimeout(() => process.exit(0), 5000);
