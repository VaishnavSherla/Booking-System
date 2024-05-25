const { createClient } = require('redis');

const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => console.error('Redis Client Error:', err));

client.connect().then(() => {
    console.log('Redis connected');
}).catch(console.error);

module.exports = client;
