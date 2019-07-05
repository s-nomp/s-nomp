var fs = require('fs');
var request = require('request');

var redis = require('redis');
var async = require('async');

var Stratum = require('stratum-pool');
var util = require('stratum-pool/lib/util.js');

let badBlocks = {}

module.exports = function(logger){

    var poolConfigs = JSON.parse(process.env.pools);

    var enabledPools = [];

    Object.keys(poolConfigs).forEach(function(coin) {
        var poolOptions = poolConfigs[coin];
        if (poolOptions.paymentProcessing &&
            poolOptions.paymentProcessing.enabled)
            enabledPools.push(coin);
    });

    async.filter(enabledPools, function(coin, callback){
        SetupForPool(logger, poolConfigs[coin], function(setupResults){
            callback(null, setupResults);
        });
    }, function(err, results){
        results.forEach(function(coin){

            var poolOptions = poolConfigs[coin];
            var processingConfig = poolOptions.paymentProcessing;
            var logSystem = 'Payments';
            var logComponent = coin;

            logger.debug(logSystem, logComponent, 'Payment processing setup with daemon ('
                + processingConfig.daemon.user + '@' + processingConfig.daemon.host + ':' + processingConfig.daemon.port
                + ') and redis (' + poolOptions.redis.host + ':' + poolOptions.redis.port + ')');
        });
    });
};

function SetupForPool(logger, poolOptions, setupFinished){


    var coin = poolOptions.coin.name;
    var processingConfig = poolOptions.paymentProcessing;

    var logSystem = 'Payments';
    var logComponent = poolOptions.coin.name;

    var cbOps = {};
    var sendOps = {};
    var completedOps = {};
    var firstOpsCheck = true;

    // zcash team recommends 10 confirmations for safety from orphaned blocks
    var minConfShield = Math.max((processingConfig.minConf || 10), 1); // Don't allow 0 conf transactions.
    var minConfPayout = Math.max((processingConfig.zMinConf || 3), 1);
    if (minConfPayout  < 3) {
        logger.warning(logSystem, logComponent, logComponent + ' minConf of 3 is recommended.');
    }

    // minimum paymentInterval of 60 seconds
    var paymentIntervalSecs = Math.max((processingConfig.paymentInterval || 120), 30);
    if (parseInt(processingConfig.paymentInterval) < 120) {
        logger.warning(logSystem, logComponent, ' minimum paymentInterval of 120 seconds recommended.');
    }

    var maxBlocksPerPayment =  Math.max(processingConfig.maxBlocksPerPayment || 3, 1);

    // pplnt - pay per last N time shares
    var pplntEnabled = processingConfig.paymentMode === "pplnt" || false;
    var pplntTimeQualify = processingConfig.pplnt || 0.51; // 51%

    var getMarketStats = poolOptions.coin.getMarketStats === true;
    var requireShielding = poolOptions.coin.requireShielding === true;
    var fee = parseFloat(poolOptions.coin.txfee) || parseFloat(0.0004);

    logger.debug(logSystem, logComponent, logComponent + ' requireShielding: ' + requireShielding);
    logger.debug(logSystem, logComponent, logComponent + ' min conf before shielding: ' + minConfShield);
    logger.debug(logSystem, logComponent, logComponent + ' min conf before payout (already sheilded): ' + minConfPayout);
    logger.debug(logSystem, logComponent, logComponent + ' payments txfee reserve: ' + fee);
    logger.debug(logSystem, logComponent, logComponent + ' maxBlocksPerPayment: ' + maxBlocksPerPayment);
    logger.debug(logSystem, logComponent, logComponent + ' PPLNT: ' + pplntEnabled + ', time period: '+pplntTimeQualify);

    var daemon = new Stratum.daemon.interface([processingConfig.daemon], function(severity, message){
        logger[severity](logSystem, logComponent, message);
    });
    var redisClient = redis.createClient(poolOptions.redis.port, poolOptions.redis.host);
    // redis auth if enabled
    if (poolOptions.redis.password) {
        redisClient.auth(poolOptions.redis.password);
    }

    var magnitude = 10**8;
    var minPaymentSatoshis =parseInt(processingConfig.minimumPayment * magnitude);
    var coinPrecision;

    var paymentInterval;

    function validateAddress(type, address, callback) {
      var cmd = '';
      if (type.toLowerCase() === 't') {
        cmd = 'validateaddress';
      }
      if (type.toLowerCase() === 'z') {
        cmd = 'z_validateaddress';
      }
      if (cmd === '') {
        callback(true);
      }
      daemon.cmd(cmd, [address], function(result) {
        if (result.error) {
          var msg = '';
          if (address === poolOptions.address) {
            msg = 'error validating mining address: ' + poolOptions.address;
          } else if (address === poolOptions.zAddress) {
            msg = 'error validating payments z address: ' + poolOptions.zAddress;
          }
          logger.error(logSystem, logComponent, msg);
          callback(true);
        } else if (!result.response || !result.response.ismine) {
          logger.error(logSystem, logComponent,
            'Daemon does not own pool address - payment processing cannot be done with this daemon, ' +
            JSON.stringify(result.response));
          callback(true);
        } else {
          callback();
        }
      }, true);
    }

    function tGetBalance(address, callback) {
      var args = [minConfShield, 99999999, [address]];
      daemon.cmd('listunspent', args, function (result) {
          if (!result || result.error || result[0].error) {
              logger.error(logSystem, logComponent, 'Error with RPC call listunspent ' + address + ' ' + JSON.stringify(result[0].error));
              callback = function (){};
              callback(true);
          }
          else {
              var balance = parseFloat(0);
              if (result[0].response != null && result[0].response.length > 0) {
                  for (var i = 0, len = result[0].response.length; i < len; i++) {
                      balance += parseFloat(result[0].response[i].amount || 0);
                  }
                  balance = coinsRound(balance);
              }
              logger.special(logSystem, logComponent, address + ' balance of ' + balance);
              callback(false, coinsToSatoshis(balance));
          }
      });
    }

    function zGetBalance(address, callback) {
      daemon.cmd('z_getbalance', [address, minConfPayout], function(result) {
        if (!result || result.error || result[0].error) {
            logger.error(logSystem, logComponent, 'Error with RPC call z_getbalance '+addr+' '+JSON.stringify(result[0].error));
            callback = function (){};
            callback(true);
        }
        else {
            var balance = parseFloat(0);
            if (result[0].response != null) {
                balance = coinsRound(result[0].response);
            }
            logger.special(logSystem, logComponent, address.substring(0,14) + '...' + address.substring(address.length - 14) + ' balance: '+(balance).toFixed(8));
            callback(false, coinsToSatoshis(balance));
        }
      })
    }

    function getBalance(type, address, callback) {
      if (type === 't') {
        tGetBalance(address, callback);
      } else if (type === 'z') {
        zGetBalance(address, callback);
      }
    }

    function roundTo(n, digits) {
        if (digits === undefined) {
            digits = 0;
        }
        var multiplicator = Math.pow(10, digits);
        n = parseFloat((n * multiplicator).toFixed(11));
        var test =(Math.round(n) / multiplicator);
        return +(test.toFixed(digits));
    }

    var satoshisToCoins = function(satoshis) {
        return roundTo((satoshis / magnitude), coinPrecision);
    };

    var coinsToSatoshis = function(coins) {
        return Math.round(coins * magnitude);
    };

    function coinsRound(number) {
        return roundTo(number, coinPrecision);
    }

    function checkForDuplicateBlockHeight(rounds, height) {
        var count = 0;
        for (var i = 0; i < rounds.length; i++) {
            if (rounds[i].height == height)
                count++;
        }
        return count > 1;
    }

    function shieldCoinbase(callback) {
      // don't allow more than 1 shieldcoinbase at a time
      if (Object.keys(cbOps).length > 0) {
        logger.warning(logSystem, logComponent, 'z_shieldcoinbase is waiting, too many z_shieldcoinbase operations already in progress.');
        logger.warning(logSystem, logComponent, JSON.parse(cbOps));
        return callback(true); // error
      }

      daemon.cmd('z_shieldcoinbase', [poolOptions.address, poolOptions.zAddress],
        function(result) {
          if (!result || result.error || result[0].error || !result[0].response) {
            logger.error(logSystem, logComponent, 'Error trying to shield balance: ' + JSON.stringify(result[0].error));
            return callback(true); // error
          }
          // response =  [{"error":null,"response":{"remainingUTXOs":734,"remainingValue":48913.7632,"shieldingUTXOs":50,"shieldingValue":3332.0001,"opid":"opid-47ca9179-eb32-4bf9-88f6-6f092d11ca11"},"instance":{"host":"localhost","port":16543,"user":"User234523452345","password":"Pass8241389489348973487934ds08","index":0}}]
          var response = result[0].response;
          var opid = response.opid;
          var utxos = response.shieldingUTXOs;
          var value = response.shieldingValue;
          cbOps[opid] = true;
          logger.special(logSystem, logComponent, 'Shielding balance ' + value + ' in ' + utxos + ' utxos ' + opid);
          return callback();
        });
    }

    // run shielding process every x minutes
    var shielding_interval = Math.max(parseInt(processingConfig.shieldingInterval || 1), 1) * 1000; // run every x minutes
    var shieldInterval = setInterval(function() {
        getBalance('t', poolOptions.address, function(error, balance) {
          if (error) {
            return;
          }
          if (balance > 0) {
            shieldCoinbase(function(shieldError = false) {
              if (shieldError) {
                return;
              }
            })
          }
        });
    }, shielding_interval);

    // network stats caching every 58 seconds
    function cacheNetworkStats () {
        var params = null;
        daemon.cmd('getmininginfo', params,
            function (result) {
                if (!result || result.error || result[0].error || !result[0].response) {
                    logger.error(logSystem, logComponent, 'Error with RPC call getmininginfo '+JSON.stringify(result[0].error));
                    return;
                }

                var coin = logComponent;
                var finalRedisCommands = [];

                if (result[0].response.blocks !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkBlocks', result[0].response.blocks]);
                }
                if (result[0].response.difficulty !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkDiff', result[0].response.difficulty]);
                }
                if (result[0].response.networkhashps !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkSols', result[0].response.networkhashps]);
                }

                daemon.cmd('getnetworkinfo', params,
                    function (result) {
                        if (!result || result.error || result[0].error || !result[0].response) {
                            logger.error(logSystem, logComponent, 'Error with RPC call getnetworkinfo '+JSON.stringify(result[0].error));
                            return;
                        }

                        if (result[0].response.connections !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkConnections', result[0].response.connections]);
                        }
                        if (result[0].response.version !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkVersion', result[0].response.version]);
                        }
                        if (result[0].response.subversion !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkSubVersion', result[0].response.subversion]);
                        }
                        if (result[0].response.protocolversion !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkProtocolVersion', result[0].response.protocolversion]);
                        }

                        if (finalRedisCommands.length <= 0)
                            return;

                        redisClient.multi(finalRedisCommands).exec(function(error, results){
                            if (error){
                                logger.error(logSystem, logComponent, 'Error with redis during call to cacheNetworkStats() ' + JSON.stringify(error));
                                return;
                            }
                        });
                    }
                );
            }
        );
    }
    var stats_interval = 58 * 1000;
    var statsInterval = setInterval(function() {
        // update network stats using coin daemon
        cacheNetworkStats();
    }, stats_interval);
    var trimCompletedOps = function() {
      var limit = 1000;
      var completedIds = Object.keys(completedOps).sort(function(a, b) {
        return completedOps[a] - completedOps[b];
      });
      var remove = [];
      if (completedIds.length > limit) {
        var start = ops.length - limit;
        remove = completedIds.slice(0, start);
      }
      remove.forEach(function(id) {
        delete completedOps[id];
      });
    }
    // check operation statuses every 45 seconds
    var opid_interval =  45 * 1000;
    // shielding not required for some equihash coins
    var checkOpids = function() {
        clearTimeout(opidTimeout);
        var checkOpIdSuccess = function(ops) {
            var batchRPC = [];
            // if there are no op-ids
            if (ops.length == 0) {
                // and we think there is
                if (Object.keys(cbOps).length !== 0) {
                    // clear them!
                    cbOps = {};
                    logger.warning(logSystem, logComponent, 'Clearing shielding operation ids due to empty result set.');
                }
                if (Object.keys(sendOps).length !== 0) {
                    // clear them!
                    sendOps = {};
                    logger.warning(logSystem, logComponent, 'Clearing z_sendmany operation ids due to empty result set.');
                }
            }
            // limit completed set to 1000
            trimCompletedOps();
            // limit working set to last 250 ops since we'll have a lot of them
            var limit = 250;
            if (ops.length > limit) {
              var start = ops.length - limit;
              ops = ops.slice(start, ops.length);
            }
            // loop through op-ids checking their status
            ops.forEach(function(op, i){
                // check operation id status
                if (op.status == "success" || op.status == "failed") {
                    // log status to console
                    if (completedOps[op.id] === undefined) {
                      if (op.status == "failed") {
                          if (op.error) {
                            logger.error(logSystem, logComponent, "Shielding operation failed " + op.id + " " + op.error.code +", " + op.error.message);
                          } else {
                            logger.error(logSystem, logComponent, "Shielding operation failed " + op.id);
                          }
                      } else {
                          if (!firstOpsCheck) {
                            // this stops us from printing a massive list of successful ops at start
                            logger.special(logSystem, logComponent, 'Shielding operation success ' + op.id + '  txid: ' + op.result.txid);
                          }
                      }
                      completedOps[op.id] = Date.now();
                    }
                    if (cbOps[op.id]) {
                      delete cbOps[op.id];
                    }
                    if (sendOps[op.id]) {
                      delete sendOps[op.id];
                    }
                } else if (op.status == "executing") {
                    logger.special(logSystem, logComponent, 'Shielding operation in progress ' + op.id );
                }
            });
            if (!firstOpsCheck) {
              firstOpsCheck = false;
            }
            // if there are no completed operations
            if (batchRPC.length <= 0) {
                opidTimeout = setTimeout(checkOpids, opid_interval);
                return;
            }
        };
        // check for completed operation ids
        daemon.cmd('z_getoperationstatus', null, function (result) {
            var err = false;
            if (result.error) {
                err = true;
                logger.error(logSystem, logComponent, 'Error with RPC call z_getoperationstatus ' + JSON.stringify(result.error));
            } else if (result.response) {
                checkOpIdSuccess(result.response);
            } else {
                err = true;
                logger.error(logSystem, logComponent, 'No response from z_getoperationstatus RPC call.');
            }
            if (err === true) {
                opidTimeout = setTimeout(checkOpids, opid_interval);
                if (Object.keys(cbOps).length !== 0) {
                    cbOps = {}
                    logger.warning(logSystem, logComponent, 'Clearing sheilding operation ids due to RPC call errors.');
                }
                if (Object.keys(sendOps).length !== 0) {
                    sendOps = {}
                    logger.warning(logSystem, logComponent, 'Clearing z_sendmany operation ids due to RPC call errors.');
                }
            }
        }, true, true);
    }
    var opidTimeout = setTimeout(checkOpids, opid_interval);

    var startPaymentProcess = Date.now();

    var timeSpentRPC = 0;
    var timeSpentRedis = 0;

    var startTimeRedis;
    var startTimeRPC;

    var startRedisTimer = function(){ startTimeRedis = Date.now() };
    var endRedisTimer = function(){ timeSpentRedis += Date.now() - startTimeRedis };

    var startRPCTimer = function(){ startTimeRPC = Date.now(); };
    var endRPCTimer = function(){ timeSpentRPC += Date.now() - startTimeRedis };

    function buildWorkerRoundObjects(callback){
        startRedisTimer();
        redisClient.multi([
            ['hgetall', coin + ':balances'],
            ['smembers', coin + ':blocksPending']
        ]).exec(function(error, results){
            endRedisTimer();
            if (error){
                logger.error(logSystem, logComponent, 'Could not get blocks from redis ' + JSON.stringify(error));
                callback(true);
                return;
            }
            // build workers object from :balances
            var workers = {};
            for (var w in results[0]){
                workers[w] = {balance: coinsToSatoshis(parseFloat(results[0][w]))};
            }
            // build rounds object from :blocksPending
            var rounds = results[1].map(function(r){
                var details = r.split(':');
                return {
                    blockHash: details[0],
                    txHash: details[1],
                    height: details[2],
                    minedby: details[3],
                    time: details[4],
                    duplicate: false,
                    serialized: r
                };
            });
            /* sort rounds by block height to pay in order */
            rounds.sort(function(a, b) {
                return a.height - b.height;
            });
            // find duplicate blocks by height
            // this can happen when two or more solutions are submitted at the same block height
            var duplicateFound = false;
            for (var i = 0; i < rounds.length; i++) {
                if (checkForDuplicateBlockHeight(rounds, rounds[i].height) === true) {
                    rounds[i].duplicate = true;
                    duplicateFound = true;
                }
            }
            // handle duplicates if needed
            if (duplicateFound) {
                var dups = rounds.filter(function(round){ return round.duplicate; });
                logger.warning(logSystem, logComponent, 'Duplicate pending blocks found: ' + JSON.stringify(dups));
                // attempt to find the invalid duplicates
                var rpcDupCheck = dups.map(function(r){
                    return ['getblock', [r.blockHash]];
                });
                startRPCTimer();
                daemon.batchCmd(rpcDupCheck, function(error, blocks){
                    endRPCTimer();
                    if (error || !blocks) {
                        logger.error(logSystem, logComponent, 'Error with duplicate block check rpc call getblock ' + JSON.stringify(error));
                        return;
                    }
                    // look for the invalid duplicate block
                    var validBlocks = {}; // hashtable for unique look up
                    var invalidBlocks = []; // array for redis work
                    blocks.forEach(function(block, i) {
                        if (block && block.result) {
                            // invalid duplicate submit blocks have negative confirmations
                            if (block.result.confirmations < 0) {
                                logger.warning(logSystem, logComponent, 'Remove invalid duplicate block ' + block.result.height + ' > ' + block.result.hash);
                                // move from blocksPending to blocksDuplicate...
                                invalidBlocks.push(['smove', coin + ':blocksPending', coin + ':blocksDuplicate', dups[i].serialized]);
                            } else {
                                // block must be valid, make sure it is unique
                                if (validBlocks.hasOwnProperty(dups[i].blockHash)) {
                                    // not unique duplicate block
                                    logger.warning(logSystem, logComponent, 'Remove non-unique duplicate block ' + block.result.height + ' > ' + block.result.hash);
                                    // move from blocksPending to blocksDuplicate...
                                    invalidBlocks.push(['smove', coin + ':blocksPending', coin + ':blocksDuplicate', dups[i].serialized]);
                                } else {
                                    // keep unique valid block
                                    validBlocks[dups[i].blockHash] = dups[i].serialized;
                                    logger.debug(logSystem, logComponent, 'Keep valid duplicate block ' + block.result.height + ' > ' + block.result.hash);
                                }
                            }
                        }
                    });
                    // filter out all duplicates to prevent double payments
                    rounds = rounds.filter(function(round){ return !round.duplicate; });
                    // if we detected the invalid duplicates, move them
                    if (invalidBlocks.length > 0) {
                        // move invalid duplicate blocks in redis
                        startRedisTimer();
                        redisClient.multi(invalidBlocks).exec(function(error, kicked){
                            endRedisTimer();
                            if (error) {
                                logger.error(logSystem, logComponent, 'Error could not move invalid duplicate blocks in redis ' + JSON.stringify(error));
                            }
                            // continue payments normally
                            callback(null, workers, rounds);
                        });
                    } else {
                        // notify pool owner that we are unable to find the invalid duplicate blocks, manual intervention required...
                        logger.error(logSystem, logComponent, 'Unable to detect invalid duplicate blocks, duplicate block payments on hold.');
                        // continue payments normally
                        callback(null, workers, rounds);
                    }
                });
            } else {
                // no duplicates, continue payments normally
                // console.log('buildWorkerRoundObjects workers:', JSON.stringify(workers))
                callback(null, workers, rounds);
            }
        });
    };

    function isBlockReady(workers, rounds, callback){
        // get pending block tx details
        var batchRPCcommand = rounds.map(function(r){
            return ['gettransaction', [r.txHash]];
        });
        // get account address (not implemented at this time)
        batchRPCcommand.push(['getaccount', [poolOptions.address]]);

        startRPCTimer();
        daemon.batchCmd(batchRPCcommand, function(error, txDetails){
            endRPCTimer();
            if (error || !txDetails){
                logger.error(logSystem, logComponent, 'Check finished - daemon rpc error with batch gettransactions ' + JSON.stringify(error));
                callback(true);
                return;
            }

            var addressAccount = "";

            // check for transaction errors and generated coins
            txDetails.forEach(function(tx, i){
                if (i === txDetails.length - 1){
                    if (tx.result && tx.result.toString().length > 0) {
                        addressAccount = tx.result.toString();
                    }
                    return;
                }
                var round = rounds[i];
                // update confirmations for round
                if (tx && tx.result)
                    round.confirmations = parseInt((tx.result.confirmations || 0));

                // look for transaction errors
                // NOTE: We should combine these two if blocks into one since the only difference is in the logged message.
                if (tx.error && tx.error.code === -5){
                    if (undefined == badBlocks[round.txHash]) {
                        badBlocks[round.txHash] = 0
                    }

                    if (badBlocks[round.txHash] >= 15) {
                        logger.warning(logSystem, logComponent, 'ERROR: Daemon reports invalid transaction: ' + round.txHash)
                        delete badBlocks[round.txHash]
                        round.category = 'kicked'
                    } else {
                        badBlocks[round.txHash]++
                        logger.warning(logSystem, logComponent, `Abandoned block ${round.txHash} check ${badBlocks[round.txHash]}/15`)
                    }

                    return;
                } else if (!tx.result.details || (tx.result.details && tx.result.details.length === 0)) {
                    if (undefined == badBlocks[round.txHash]) {
                        badBlocks[round.txHash] = 0
                    }

                    if (badBlocks[round.txHash] >= 15) {
                        logger.warning(logSystem, logComponent, 'ERROR: Daemon reports no details for transaction: ' + round.txHash)
                        delete badBlocks[round.txHash]
                        round.category = 'kicked'
                    } else {
                        badBlocks[round.txHash]++
                        logger.warning(logSystem, logComponent, `Abandoned block ${round.txHash} check ${badBlocks[round.txHash]}/15`)
                    }

                    return;
                } else if (tx.error || !tx.result) {
                    return logger.error(logSystem, logComponent, `ERROR: Odd error with gettransaction ${round.txHash} ${JSON.stringify(tx)}`)
                }

                // get the coin base generation tx
                const generationTx = tx.result.details.filter(tx => tx.address === poolOptions.address)[0]

                if (!generationTx && tx.result.details.length === 1) {
                    generationTx = tx.result.details[0]
                }

                if (!generationTx){
                    return logger.error(logSystem, logComponent, `ERROR: Missing output details to pool address for transaction ${round.txHash}`)
                }

                // get transaction category for round
                round.category = generationTx.category

                // get reward for newly generated blocks
                if (round.category === 'generate' || round.category === 'immature') {
                    round.reward = coinsRound(parseFloat(generationTx.amount || generationTx.value))
                }

                // Clear blocks that previously triggered an attempted kick.
                if (!round.txHash in badBlocks) {
                    logger.error(logSystem, logComponent, `${round.txHash} is no longer bad!`)
                    delete badBlocks[round.txHash]
                }
            });

            var canDeleteShares = function(r){
                for (var i = 0; i < rounds.length; i++){
                    var compareR = rounds[i];
                    if ((compareR.height === r.height)
                        && (compareR.category !== 'kicked')
                        && (compareR.category !== 'orphan')
                        && (compareR.serialized !== r.serialized)){
                        return false;
                    }
                }
                return true;
            };

            // only pay max blocks at a time
            var payingBlocks = 0;
            rounds = rounds.filter(function(r){
                switch (r.category) {
                    case 'orphan':
                    case 'kicked':
                        r.canDeleteShares = canDeleteShares(r);
                    case 'immature':
                        return true;
                    case 'generate':
                        payingBlocks++;
                        // if over maxBlocksPerPayment...
                        // change category to immature to prevent payment
                        // and to keep track of confirmations/immature balances
                        if (payingBlocks > maxBlocksPerPayment)
                            r.category = 'immature';
                        return true;
                    default:
                        return false;
                };
            });

            // continue to next step in waterfall
            callback(null, workers, rounds, addressAccount);
        });
    };

    function lookupSharesCalcRewards(workers, rounds, addressAccount, callback){
        // pplnt times lookup
        var timeLookups = rounds.map(function(r){
            return ['hgetall', coin + ':shares:times' + r.height]
        });
        startRedisTimer();
        redisClient.multi(timeLookups).exec(function(error, allWorkerTimes){
            endRedisTimer();
            if (error){
                callback('Check finished - redis error with multi get rounds time');
                return;
            }
            // shares lookup
            var shareLookups = rounds.map(function(r){
                return ['hgetall', coin + ':shares:round' + r.height];
            });
            startRedisTimer();
            redisClient.multi(shareLookups).exec(function(error, allWorkerShares){
                endRedisTimer();
                if (error){
                    callback('Check finished - redis error with multi get rounds share');
                    return;
                }

                // error detection
                var err = null;
                var performPayment = false;

                var notAddr = null;
                if (requireShielding === true) {
                    notAddr = poolOptions.address;
                }

                // calculate what the pool owes its miners
                var feeSatoshi = coinsToSatoshis(fee);
                var totalOwed = parseInt(0);
                for (var i = 0; i < rounds.length; i++) {
                    // only pay generated blocks, not orphaned, kicked, immature
                    if (rounds[i].category == 'generate') {
                        totalOwed = totalOwed + coinsToSatoshis(rounds[i].reward) - feeSatoshi;
                    }
                }
                // also include balances owed
                for (var w in workers) {
                    var worker = workers[w];
                    totalOwed = totalOwed + (worker.balance||0);
                }
                // check if we have enough zAddress funds to begin payment processing
                getBalance('z', poolOptions.zAddress, function (error, balance){
                    if (error) {
                        logger.error(logSystem, logComponent, 'Error checking pool balance before processing payments.');
                        return callback(true);
                    } else if (balance < totalOwed) {
                        logger.error(logSystem, logComponent,  'Insufficient funds ('+satoshisToCoins(balance) + ') to process payments (' + satoshisToCoins(totalOwed)+'); possibly waiting for txs.');
                        performPayment = false;
                    } else if (balance > totalOwed) {
                        performPayment = true;
                    }
                    // just in case...
                    if (totalOwed <= 0) {
                        performPayment = false;
                    }
                    // if we can not perform payment
                    if (performPayment === false) {
                        // convert category generate to immature
                        rounds = rounds.filter(function(r){
                            switch (r.category) {
                                case 'orphan':
                                case 'kicked':
                                case 'immature':
                                   return true;
                               case 'generate':
                                   r.category = 'immature';
                                   return true;
                                default:
                                    return false;
                            };
                        });
                    }

                    // handle rounds
                    rounds.forEach(function(round, i){
                        var workerShares = allWorkerShares[i];
                        if (!workerShares){
                            err = true;
                            logger.error(logSystem, logComponent, 'No worker shares for round: ' + round.height + ' blockHash: ' + round.blockHash);
                            return;
                        }
                        var workerTimesWithPoolIds = allWorkerTimes[i];
                        var workerTimes = {};
                        var maxTime = 0;
                        if (pplntEnabled === true) {
                          for (var workerAddressWithPoolId in workerTimesWithPoolIds){
                                var workerWithoutPoolId = workerAddressWithPoolId.split('.')[0];
                                var workerTimeFloat = parseFloat(workerTimesWithPoolIds[workerAddressWithPoolId]);
                                if (maxTime < workerTimeFloat) {
                                    maxTime = workerTimeFloat;
                                }
                              if (!(workerWithoutPoolId in workerTimes)) {
                                  workerTimes[workerWithoutPoolId] = workerTimeFloat;
                              } else {
                                    // add time from other instances with penalty
                                  if (workerTimes[workerWithoutPoolId] < workerTimeFloat) {
                                      workerTimes[workerWithoutPoolId] = workerTimes[workerWithoutPoolId] * 0.5 + workerTimeFloat;
                                  } else {
                                        workerTimes[workerWithoutPoolId] = workerTimes[workerWithoutPoolId] + workerTimeFloat * 0.5;
                                    }
                                    if (workerTimes[workerWithoutPoolId] > maxTime) {
                                        workerTimes[workerWithoutPoolId] = maxTime;
                                    }
                              }
                          }
                        }
                        switch (round.category){
                            case 'kicked':
                            case 'orphan':
                                round.workerShares = workerShares;
                                break;

                            /* calculate immature balances */
                            case 'immature':
                                var feeSatoshi = coinsToSatoshis(fee);
                                var immature = coinsToSatoshis(round.reward);
                                var totalShares = parseFloat(0);
                                var sharesLost = parseFloat(0);

                                // adjust block immature .. tx fees
                                immature = Math.round(immature - feeSatoshi);

                                // total up shares for round
                                for (var workerAddress in workerShares){
                                    var worker = workers[workerAddress] = (workers[workerAddress] || {});
                                    var shares = parseFloat((workerShares[workerAddress] || 0));
                                    // if pplnt mode
                                    if (pplntEnabled === true && maxTime > 0) {
                                        var tshares = shares;
                                        var lost = parseFloat(0);
                                        var address = workerAddress.split('.')[0];
                                        if (workerTimes[address] != null && parseFloat(workerTimes[address]) > 0) {
                                            var timePeriod = roundTo(parseFloat(workerTimes[address] || 1) / maxTime , 2);
                                            if (timePeriod > 0 && timePeriod < pplntTimeQualify) {
                                                var lost = shares - (shares * timePeriod);
                                                sharesLost += lost;
                                                shares = Math.max(shares - lost, 0);
                                            }
                                        }
                                    }
                                    worker.roundShares = shares;
                                    totalShares += shares;
                                }

                                // console.log('--IMMATURE DEBUG--------------');
                                // console.log('performPayment: '+performPayment);
                                // console.log('blockHeight: '+round.height);
                                // console.log('blockReward: '+Math.round(immature));
                                // console.log('blockConfirmations: '+round.confirmations);

                                // calculate rewards for round
                                var totalAmount = 0;
                                for (var workerAddress in workerShares){
                                    var worker = workers[workerAddress] = (workers[workerAddress] || {});
                                    var percent = parseFloat(worker.roundShares) / totalShares;
                                    // calculate workers immature for this round
                                    var workerImmatureTotal = Math.round(immature * percent);
                                    worker.immature = (worker.immature || 0) + workerImmatureTotal;
                                    totalAmount += workerImmatureTotal;
                                }

                                // console.log('----------------------------');
                                break;

                            /* calculate reward balances */
                            case 'generate':
                                var feeSatoshi = coinsToSatoshis(fee);
                                var reward = coinsToSatoshis(round.reward);
                                var totalShares = parseFloat(0);
                                var sharesLost = parseFloat(0);

                                // adjust block reward .. tx fees
                                reward = Math.round(reward - feeSatoshi);

                                // total up shares for round
                                for (var workerAddress in workerShares){
                                    var worker = workers[workerAddress] = (workers[workerAddress] || {});
                                    var shares = parseFloat((workerShares[workerAddress] || 0));
                                    // if pplnt mode
                                    if (pplntEnabled === true && maxTime > 0) {
                                        var tshares = shares;
                                        var lost = parseFloat(0);
                                        var address = workerAddress.split('.')[0];
                                        if (workerTimes[address] != null && parseFloat(workerTimes[address]) > 0) {
                                            var timePeriod = roundTo(parseFloat(workerTimes[address] || 1) / maxTime , 2);
                                            if (timePeriod > 0 && timePeriod < pplntTimeQualify) {
                                                var lost = shares - (shares * timePeriod);
                                                sharesLost += lost;
                                                shares = Math.max(shares - lost, 0);
                                                logger.warning(logSystem, logComponent, 'PPLNT: Reduced shares for '+workerAddress+' round:' + round.height + ' maxTime:'+maxTime+'sec timePeriod:'+roundTo(timePeriod,6)+' shares:'+tshares+' lost:'+lost+' new:'+shares);
                                            }
                                            if (timePeriod > 1.0) {
                                                err = true;
                                                logger.error(logSystem, logComponent, 'Time share period is greater than 1.0 for '+workerAddress+' round:' + round.height + ' blockHash:' + round.blockHash);
                                                return;
                                            }
                                            worker.timePeriod = timePeriod;
                                        }
                                    }
                                    worker.roundShares = shares;
                                    worker.totalShares = parseFloat(worker.totalShares || 0) + shares;
                                    totalShares += shares;
                                }

                                // console.log('--REWARD DEBUG--------------');
                                // console.log('performPayment: '+performPayment);
                                // console.log('blockHeight: '+round.height);
                                // console.log('blockReward: ' + Math.round(reward));
                                // console.log('blockConfirmations: '+round.confirmations);

                                // calculate rewards for round
                                var totalAmount = 0;
                                for (var workerAddress in workerShares){
                                    var worker = workers[workerAddress] = (workers[workerAddress] || {});
                                    var percent = parseFloat(worker.roundShares) / totalShares;
                                    if (percent > 1.0) {
                                        err = true;
                                        logger.error(logSystem, logComponent, 'Share percent is greater than 1.0 for '+workerAddress+' round:' + round.height + ' blockHash:' + round.blockHash);
                                        return;
                                    }
                                    // calculate workers reward for this round
                                    var workerRewardTotal = Math.round(reward * percent);
                                    worker.reward = (worker.reward || 0) + workerRewardTotal;
                                    totalAmount += workerRewardTotal;
                                }

                                // console.log('----------------------------');
                                break;
                        }
                    });

                    // if there was no errors
                    if (err === null) {
                        callback(null, workers, rounds, addressAccount);
                    } else {
                        // some error, stop waterfall
                        callback(true);
                    }

                }); // end funds check
            });// end share lookup
        }); // end time lookup
    };

    var getProperAddress = function(address){
        if (address.length >= 90){
            logger.warning(logSystem, logComponent, 'Invalid address '+address+', convert to address '+(poolOptions.invalidAddress || poolOptions.address));
            return (poolOptions.invalidAddress || poolOptions.address);
        }
        if (address.length <= 70) {
            logger.warning(logSystem, logComponent, 'Invalid address '+address+', convert to address '+(poolOptions.invalidAddress || poolOptions.address));
            return (poolOptions.invalidAddress || poolOptions.address);
        }
        return address;
    };

    function genCommandsAndSend(workers, rounds, addressAccount, callback) {
        var tries = 0;
        var trySend = function (withholdPercent) {
            var addressAmounts = {};
            var balanceAmounts = {};
            var shareAmounts = {};
            var timePeriods = {};
            var minerTotals = {};
            var totalSent = 0;
            var totalShares = 0;

            // track attempts made, calls to trySend...
            tries++;

            for (var w in workers) {
                var worker = workers[w];
                totalShares += (worker.totalShares || 0)
                worker.balance = worker.balance || 0;
                worker.reward = worker.reward || 0;
                // get miner payout totals
                var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
                var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
                if (minerTotals[address] !== null && minerTotals[address] > 0) {
                    minerTotals[address] += toSendSatoshis;
                } else {
                    minerTotals[address] = toSendSatoshis;
                }
            }
            // now process each workers balance, and pay the miner
            for (var w in workers) {
                var worker = workers[w];
                worker.balance = worker.balance || 0;
                worker.reward = worker.reward || 0;
                var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
                var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
                // if miners total is enough, go ahead and add this worker balance
                if (minerTotals[address] >= minPaymentSatoshis) {
                    totalSent += toSendSatoshis;
                    // send funds
                    worker.sent = satoshisToCoins(toSendSatoshis);
                    worker.balanceChange = Math.min(worker.balance, toSendSatoshis) * -1;
                    if (addressAmounts[address] !== null && addressAmounts[address] > 0) {
                        addressAmounts[address] = coinsRound(addressAmounts[address] + worker.sent);
                    } else {
                        addressAmounts[address] = worker.sent;
                    }
                } else {
                    // add to balance, not enough minerals
                    worker.sent = 0;
                    worker.balanceChange = Math.max(toSendSatoshis - worker.balance, 0);
                    // track balance changes
                    if (worker.balanceChange > 0) {
                        if (balanceAmounts[address] !== null && balanceAmounts[address] > 0) {
                            balanceAmounts[address] = coinsRound(balanceAmounts[address] + satoshisToCoins(worker.balanceChange));
                        } else {
                            balanceAmounts[address] = satoshisToCoins(worker.balanceChange);
                        }
                    }
                }
                // track share work
                if (worker.totalShares > 0) {
                    if (shareAmounts[address] != null && shareAmounts[address] > 0) {
                        shareAmounts[address] += worker.totalShares;
                    } else {
                        shareAmounts[address] = worker.totalShares;
                    }
                }
            }
            // console.log('minertotals:', JSON.stringify(minerTotals))
            // console.log('workers:', JSON.stringify(workers))

            // if no payouts...continue to next set of callbacks
            // console.log(JSON.stringify(addressAmounts));
            if (Object.keys(addressAmounts).length === 0){
                callback(null, workers, rounds, []);
                return;
            }

            // do final rounding of payments per address
            // this forces amounts to be valid (0.12345678)
            var addrsAmounts = [];
            for (var a in addressAmounts) {
                addressAmounts[a] = coinsRound(addressAmounts[a]);
                addrsAmounts.push({address: a, amount: coinsRound(addressAmounts[a])})
            }

            // POINT OF NO RETURN! GOOD LUCK!
            // WE ARE SENDING PAYMENT CMD TO DAEMON

            // perform the sendmany operation .. addressAccount
            var rpccallTracking = 'z_sendmany "" '+JSON.stringify(addrsAmounts);
            //console.log(rpccallTracking);
            logger.special(logSystem, logComponent, rpccallTracking);
            daemon.cmd('z_sendmany', [poolOptions.zAddress, addrsAmounts], function (result) {
                // check for failed payments, there are many reasons
                if (result.error && result.error.code === -6) {
                    // check if it is because we don't have enough funds
                    if (result.error.message && result.error.message.includes("insufficient funds")) {
                        // only try up to XX times (Max, 0.5%)
                        if (tries < 5) {
                            // we thought we had enough funds to send payments, but apparently not...
                            // try decreasing payments by a small percent to cover unexpected tx fees?
                            var higherPercent = withholdPercent + 0.001; // 0.1%
                            logger.warning(logSystem, logComponent, 'Insufficient funds (??) for payments ('+satoshisToCoins(totalSent)+'), decreasing rewards by ' + (higherPercent * 100).toFixed(1) + '% and retrying');
                            trySend(higherPercent);
                        } else {
                            logger.warning(logSystem, logComponent, rpccallTracking);
                            logger.error(logSystem, logComponent, "Error sending payments, decreased rewards by too much!!!");
                            callback(true);
                        }
                    } else {
                        // there was some fatal payment error?
                        logger.warning(logSystem, logComponent, rpccallTracking);
                        logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                        // payment failed, prevent updates to redis
                        callback(true);
                    }
                    return;
                }
                else if (result.error && result.error.code === -5) {
                    // invalid address specified in addressAmounts array
                    logger.warning(logSystem, logComponent, rpccallTracking);
                    logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                    // payment failed, prevent updates to redis
                    callback(true);
                    return;
                }
                else if (result.error && result.error.message != null) {
                    // invalid amount, others?
                    logger.warning(logSystem, logComponent, rpccallTracking);
                    logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                    // payment failed, prevent updates to redis
                    callback(true);
                    return;
                }
                else if (result.error) {
                    // unknown error
                    logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                    // payment failed, prevent updates to redis
                    callback(true);
                    return;
                }
                else {

                    // make sure sendmany gives us back a txid
                    var txid = null;
                    if (result.response) {
                        txid = result.response;
                    }
                    if (txid != null) {

                        // it worked, congrats on your pools payout ;)
                        logger.special(logSystem, logComponent, 'Sent ' + satoshisToCoins(totalSent)
                            + ' to ' + Object.keys(addressAmounts).length + ' miners; txid: '+txid);

                        if (withholdPercent > 0) {
                            logger.warning(logSystem, logComponent, 'Had to withhold ' + (withholdPercent * 100)
                                + '% of reward from miners to cover transaction fees. '
                                + 'Fund pool wallet with coins to prevent this from happening');
                        }

                        // save payments data to redis
                        var paymentBlocks = rounds.filter(function(r){ return r.category == 'generate'; }).map(function(r){
                            return parseInt(r.height);
                        });

                        var paymentsUpdate = [];
                        var paymentsData = {time:Date.now(), txid:txid, shares:totalShares, paid:satoshisToCoins(totalSent),  miners:Object.keys(addressAmounts).length, blocks: paymentBlocks, amounts: addressAmounts, balances: balanceAmounts, work:shareAmounts};
                        paymentsUpdate.push(['zadd', logComponent + ':payments', Date.now(), JSON.stringify(paymentsData)]);

                        callback(null, workers, rounds, paymentsUpdate);

                    } else {

                        clearInterval(paymentInterval);

                        logger.error(logSystem, logComponent, 'Error RPC sendmany did not return txid '
                            + JSON.stringify(result) + 'Disabling payment processing to prevent possible double-payouts.');

                        callback(true);
                        return;
                    }
                }
            }, true, true);
        };

        // attempt to send any owed payments
        trySend(0);
    };

    function updateRedis(workers, rounds, paymentsUpdate, callback){

        var totalPaid = parseFloat(0);

        var immatureUpdateCommands = [];
        var balanceUpdateCommands = [];
        var workerPayoutsCommand = [];

        // update worker paid/balance stats
        for (var w in workers) {
            var worker = workers[w];
            // update balances
            if ((worker.balanceChange || 0) !== 0){
                balanceUpdateCommands.push([
                    'hincrbyfloat',
                    coin + ':balances',
                    w,
                    satoshisToCoins(worker.balanceChange)
                ]);
            }
            // update payouts
            if ((worker.sent || 0) > 0){
                workerPayoutsCommand.push(['hincrbyfloat', coin + ':payouts', w, coinsRound(worker.sent)]);
                totalPaid = coinsRound(totalPaid + worker.sent);
            }
            // update immature balances
            if ((worker.immature || 0) > 0) {
                immatureUpdateCommands.push(['hset', coin + ':immature', w, worker.immature]);
            } else {
                immatureUpdateCommands.push(['hset', coin + ':immature', w, 0]);
            }
        }

        var movePendingCommands = [];
        var roundsToDelete = [];
        var orphanMergeCommands = [];

        var confirmsUpdate = [];
        var confirmsToDelete = [];

        var moveSharesToCurrent = function(r){
            var workerShares = r.workerShares;
            if (workerShares != null) {
                logger.warning(logSystem, logComponent, 'Moving shares from orphaned block '+r.height+' to current round.');
                Object.keys(workerShares).forEach(function(worker){
                    orphanMergeCommands.push(['hincrby', coin + ':shares:roundCurrent', worker, workerShares[worker]]);
                });
            }
        };

        rounds.forEach(function(r){
            switch(r.category){
                case 'kicked':
                case 'orphan':
                    confirmsToDelete.push(['hdel', coin + ':blocksPendingConfirms', r.blockHash]);
                    movePendingCommands.push(['smove', coin + ':blocksPending', coin + ':blocksKicked', r.serialized]);
                    if (r.canDeleteShares){
                        moveSharesToCurrent(r);
                        roundsToDelete.push(coin + ':shares:round' + r.height);
                        roundsToDelete.push(coin + ':shares:times' + r.height);
                    }
                    return;
                case 'immature':
                    confirmsUpdate.push(['hset', coin + ':blocksPendingConfirms', r.blockHash, (r.confirmations || 0)]);
                    return;
                case 'generate':
                    confirmsToDelete.push(['hdel', coin + ':blocksPendingConfirms', r.blockHash]);
                    movePendingCommands.push(['smove', coin + ':blocksPending', coin + ':blocksConfirmed', r.serialized]);
                    roundsToDelete.push(coin + ':shares:round' + r.height);
                    roundsToDelete.push(coin + ':shares:times' + r.height);
                    return;
            }
        });

        var finalRedisCommands = [];

        if (movePendingCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(movePendingCommands);

        if (orphanMergeCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(orphanMergeCommands);

        if (immatureUpdateCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(immatureUpdateCommands);

        if (balanceUpdateCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(balanceUpdateCommands);

        if (workerPayoutsCommand.length > 0)
            finalRedisCommands = finalRedisCommands.concat(workerPayoutsCommand);

        if (roundsToDelete.length > 0)
            finalRedisCommands.push(['del'].concat(roundsToDelete));

        if (confirmsUpdate.length > 0)
            finalRedisCommands = finalRedisCommands.concat(confirmsUpdate);

        if (confirmsToDelete.length > 0)
            finalRedisCommands = finalRedisCommands.concat(confirmsToDelete);

        if (paymentsUpdate.length > 0)
            finalRedisCommands = finalRedisCommands.concat(paymentsUpdate);

        if (totalPaid !== 0)
            finalRedisCommands.push(['hincrbyfloat', coin + ':stats', 'totalPaid', totalPaid]);

        if (finalRedisCommands.length === 0){
            callback();
            return;
        }

        startRedisTimer();
        redisClient.multi(finalRedisCommands).exec(function(error, results){
            endRedisTimer();
            if (error) {
                clearInterval(paymentInterval);

                logger.error(logSystem, logComponent,
                        'Payments sent but could not update redis. ' + JSON.stringify(error)
                        + ' Disabling payment processing to prevent possible double-payouts. The redis commands in '
                        + coin + '_finalRedisCommands.txt must be ran manually');

                fs.writeFile(coin + '_finalRedisCommands.txt', JSON.stringify(finalRedisCommands), function(err){
                    logger.error('Could not write finalRedisCommands.txt, you are fucked.');
                });
            }
            callback();
        });
    };

    var paymentProcessingStats = function(){
        var paymentProcessTime = Date.now() - startPaymentProcess;
        logger.debug(logSystem, logComponent, 'Finished interval - time spent: '
            + paymentProcessTime + 'ms total, ' + timeSpentRedis + 'ms redis, '
            + timeSpentRPC + 'ms daemon RPC');
    };

    var processPayments = function(){
      logger.special(logSystem, logComponent, 'Processing payments...');
        async.waterfall([
            /*
                Step 1 - build workers and rounds objects from redis
                         * removes duplicate block submissions from redis
            */
            buildWorkerRoundObjects,

            /*
                Step 2 - check if mined block coinbase tx are ready for payment
                         * adds block reward to rounds object
                         * adds block confirmations count to rounds object
            */
            isBlockReady,

            /*
                Step 3 - lookup shares and calculate rewards
                         * pull pplnt times from redis
                         * pull shares from redis
                         * calculate rewards
                         * pplnt share reductions if needed
            */
            lookupSharesCalcRewards,


            /*
               Step 4 - Generate RPC commands to send payments
               When deciding the sent balance, it the difference should be -1*amount they had in db,
               If not sending the balance, the differnce should be +(the amount they earned this round)
            */
            genCommandsAndSend,

            /*
                Step 5 - Final redis commands
            */
            updateRedis

        ], paymentProcessingStats);
    };

    function asyncComplete(err) {

      if (err) {
        setupFinished(false);
        return;
      }
      // if (paymentInterval) {
        paymentInterval = setInterval(processPayments, paymentIntervalSecs * 1000);
        setupFinished(true);
        // wait 5 seconds, start payments once manually
        setTimeout(processPayments, 5000)
      // }
    }

    async.parallel([
      function(cb) { validateAddress('t', poolOptions.address, cb); },
      function(cb) { validateAddress('z', poolOptions.zAddress, cb); },
      function(cb) { getBalance('t', poolOptions.address, cb); }
    ], asyncComplete);
}
