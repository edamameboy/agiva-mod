require('dotenv').config();
const WebSocket = require('ws');
const key = process.env.EULERSTREAM_API_KEY || '';
if (!key) {
  console.error('Missing EULERSTREAM_API_KEY in .env');
  process.exit(1);
}
const ws = new WebSocket('wss://ws.eulerstream.com?uniqueId=tiktok&apiKey=' + key);

ws.on('message', (d) => {
  const json = JSON.parse(d.toString());
  if (!json.messages) return;
  for(const msg of json.messages) {
    if (msg.type === 'WebcastGiftMessage') console.log('GIFT', JSON.stringify(msg.data).slice(0, 200));
    if (msg.type === 'WebcastLikeMessage') console.log('LIKE', JSON.stringify(msg.data).slice(0, 200));
    if (msg.type === 'WebcastSocialMessage') console.log('SOCIAL', JSON.stringify(msg.data).slice(0, 200));
    if (msg.type === 'WebcastMemberMessage') console.log('MEMBER', JSON.stringify(msg.data).slice(0, 200));
  }
});
setTimeout(() => process.exit(0), 10000);
