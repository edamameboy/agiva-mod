const WebSocket = require('ws');
const key = 'euler_ZWE0NGY5YTI0YTVlNzM3YTg3ZDY3ODFiMDI4NzY0MzlmMzE3Zjg3N2RmYWYzMmM5Yjk3NDQ0';
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
