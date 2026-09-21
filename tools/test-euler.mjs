import { WebcastEventEmitter, createWebSocketUrl } from '@eulerstream/euler-websocket-sdk';
import WebSocket from 'ws';

const key = 'euler_ZWE0NGY5YTI0YTVlNzM3YTg3ZDY3ODFiMDI4NzY0MzlmMzE3Zjg3N2RmYWYzMmM5Yjk3NDQ0';
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
