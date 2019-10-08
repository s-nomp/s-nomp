var redis = require('redis');

module.exports = function createRedisClient(redisConfig) {

    var bSocket = ((typeof redisConfig.socket !== "undefined") && (redisConfig.socket != ""));
    var client = bSocket ?
        redis.createClient(redisConfig.socket) :
        redis.createClient(redisConfig.port, redisConfig.host);

    client.snompEndpoint = bSocket ? redisConfig.socket : redisConfig.host + ':' + redisConfig.port;

    return client;
};
