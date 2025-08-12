const webPush = require('web-push');
const keys = webPush.generateVAPIDKeys();
console.log(keys);