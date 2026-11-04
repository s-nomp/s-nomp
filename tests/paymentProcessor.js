'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

// An optional source argument lets the same checks exercise an earlier processor revision.
var sourcePath = process.argv[3] || path.join(__dirname, '../libs/paymentProcessor.js');
var source = fs.readFileSync(sourcePath === '-' ? 0 : sourcePath, 'utf8');

function processor(tBalance, zBalance, fee, singleBlock, privacyPolicy, legacyWallet) {
    var calls = [];
    var batches = [];
    var intervals = {};
    var timeouts = {};
    var finishSetup;
    var balances = {coinbase: Math.round(tBalance * 1e8), shielded: Math.round(zBalance * 1e8), payout: 0};
    var fees = 0;
    var opid;
    var miner = 'tm12345678901234567890123456789012345';
    var redisCommands = [];
    var pool = {
        coin: {name: 'zcash', requireShielding: true, txfee: fee || 0.0004, poolOptions: {},
            privacyPolicy: privacyPolicy === undefined ? 'AllowRevealedRecipients' : privacyPolicy},
        address: 'coinbase-address',
        zAddress: 'sapling-address',
        tAddress: 'payout-address',
        walletInterval: 1,
        redis: {host: '127.0.0.1', port: 6379},
        paymentProcessing: {
            enabled: true,
            minConf: 7,
            paymentInterval: 120,
            minimumPayment: 0.05,
            daemon: {host: '127.0.0.1', port: 18232, user: 'pool'}
        }
    };
    if (!legacyWallet) pool.coin.unshieldFee = 0.00015;
    var daemon = {
        cmd: function(method, params, callback) {
            calls.push({method: method, params: JSON.parse(JSON.stringify(params))});
            switch (method) {
                case 'validateaddress':
                case 'z_validateaddress':
                    return callback({response: {ismine: true}});
                case 'getbalance':
                    return callback({data: '{"result":1.00000000,"error":null}'});
                case 'listunspent':
                    var outputs = [
                        {address: pool.address, amount: balances.coinbase / 1e8},
                        {address: pool.tAddress, amount: balances.payout / 1e8}
                    ];
                    return callback([{response: outputs.filter(function(output) {
                        return !params[2] || params[2].indexOf(output.address) !== -1;
                    })}]);
                case 'z_getbalance':
                    return callback([{response: balances.shielded / 1e8}]);
                case 'z_shieldcoinbase':
                    balances.shielded += balances.coinbase - 15000;
                    balances.coinbase = 0;
                    fees += 15000;
                    opid = 'opid-shield';
                    return callback([{response: {opid: 'opid-shield', shieldingUTXOs: 1}}]);
                case 'z_sendmany':
                    var amount = Math.round(params[1][0].amount * 1e8);
                    var unshieldFee = Math.round((params[3] === undefined ? 0.0001 : params[3]) * 1e8);
                    assert.strictEqual(amount + unshieldFee, balances.shielded);
                    balances.shielded = 0;
                    balances.payout += amount;
                    fees += unshieldFee;
                    opid = 'opid-unshield';
                    return callback([{response: 'opid-unshield'}]);
                case 'sendmany':
                    var total = Object.keys(params[1]).reduce(function(sum, address) {
                        return sum + Math.round(params[1][address] * 1e8);
                    }, 0);
                    assert(balances.payout >= total + 10000, 'payout must leave its ZIP 317 fee');
                    balances.payout -= total + 10000;
                    fees += 10000;
                    return callback({response: 'txid-payout'});
                case 'z_getoperationstatus':
                    return callback({response: [{
                        id: opid, status: 'success', result: {txid: 'txid-' + opid}
                    }]});
                default:
                    throw new Error('Unexpected RPC: ' + method);
            }
        },
        batchCmd: function(commands, callback) {
            batches.push(JSON.parse(JSON.stringify(commands)));
            callback(null, commands.map(function(command) {
                if (command[0] === 'gettransaction') {
                    return {result: {confirmations: 100, details: [{
                        address: pool.address, category: 'generate', amount: 6.25
                    }]}};
                }
                return {result: ''};
            }));
        }
    };
    var modules = {
        fs: fs,
        request: function() { throw new Error('Unexpected HTTP request'); },
        redis: {},
        async: {
            filter: function(pools, predicate, callback) {
                predicate(pools[0], function(err, enabled) {
                    assert.ifError(err);
                    assert(enabled, 'processor setup must succeed');
                    callback(null, pools);
                });
            },
            parallel: function(tasks, callback) {
                var remaining = tasks.length;
                tasks.forEach(function(task) {
                    task(function(err) {
                        assert.ifError(err);
                        if (--remaining === 0) finishSetup = callback;
                    });
                });
            },
            waterfall: function(tasks, callback) {
                var index = 0;
                function next(err) {
                    if (err || index === tasks.length) return callback(err);
                    var args = Array.prototype.slice.call(arguments, 1);
                    tasks[index++].apply(null, args.concat(next));
                }
                next();
            }
        },
        'stratum-pool': {daemon: {interface: function() { return daemon; }}},
        'stratum-pool/lib/util.js': {},
        './createRedisClient.js': function() {
            return {multi: function(commands) {
                redisCommands.push(JSON.parse(JSON.stringify(commands)));
                return {exec: function(callback) {
                    if (commands[0][1] === 'zcash:balances') {
                        return callback(null, [{}, singleBlock ? ['block:coinbase-tx:1:' + miner + ':0'] : []]);
                    }
                    callback(null, commands.map(function(command) {
                        var shares = {};
                        shares[miner] = 1;
                        return shares;
                    }));
                }};
            }};
        }
    };
    var context = {
        module: {exports: {}},
        require: function(name) {
            assert(Object.prototype.hasOwnProperty.call(modules, name), name);
            return modules[name];
        },
        process: {env: {pools: JSON.stringify({zcash: pool})}},
        setInterval: function(callback, delay) { intervals[delay] = callback; return callback; },
        clearInterval: function() {},
        setTimeout: function(callback, delay) { timeouts[delay] = callback; return callback; },
        clearTimeout: function() {}
    };
    vm.runInNewContext(source, context, {filename: 'libs/paymentProcessor.js'});
    context.module.exports({
        debug: function() {},
        warning: function() {},
        special: function() {},
        error: function(system, coin, message) { throw new Error(message); }
    });
    // Real RPC callbacks complete after the processor has initialized its payment function.
    finishSetup();
    return {
        shieldTick: function() { intervals[60000](); },
        poll: function() { timeouts[57000](); },
        pay: function() { intervals[120000](); },
        balances: balances,
        fees: function() { return fees; },
        redisCommands: redisCommands,
        batches: batches,
        calls: function(method) { return calls.filter(function(call) { return call.method === method; }); }
    };
}

function unshield(balance, fee, privacyPolicy, legacyWallet) {
    var wallet = processor(0, balance, fee, false, privacyPolicy, legacyWallet);
    wallet.shieldTick();
    wallet.shieldTick();
    return wallet.calls('z_sendmany');
}

var tests = {
    shielding: function() {
        var wallet = processor(1, 1);
        wallet.shieldTick();
        assert.strictEqual(wallet.calls('z_shieldcoinbase').length, 1);
        wallet.poll();
        assert.deepStrictEqual(wallet.batches[0][0], [
            'z_getoperationresult', [['opid-shield']]
        ], 'completed shielding must be tracked by its string operation id');
        wallet.shieldTick();
        assert.strictEqual(wallet.calls('z_sendmany').length, 1,
            'completed shielding must release the next unshielding operation');
    },
    fee: function() {
        [0.0004, 0.0007].forEach(function(fee) {
            var sends = unshield(1, fee);
            assert.strictEqual(sends.length, 1);
            assert.strictEqual(sends[0].params[1][0].amount, 0.99985,
                'unshielding must reserve only its own ZIP 317 fee');
            assert.strictEqual(sends[0].params[3], 0.00015,
                'the per-block fee budget is not the unshielding fee');
        });
    },
    'fee-boundary': function() {
        [0.00014, 0.00015].forEach(function(balance) {
            assert.strictEqual(unshield(balance, 0.0004).length, 0,
                'a balance at or below the fee must not be unshielded');
        });
        var sends = unshield(0.00015001, 0.0004);
        assert.strictEqual(sends.length, 1);
        assert.strictEqual(sends[0].params[1][0].amount, 0.00000001);
    },
    privacy: function() {
        var sends = unshield(1);
        assert.strictEqual(sends.length, 1);
        assert.deepStrictEqual(sends[0].params.slice(2), [7, 0.00015, 'AllowRevealedRecipients'],
            'Sapling-to-transparent payouts need explicit confirmations, fee and privacy policy');
        assert.strictEqual(sends[0].params[0], 'sapling-address');
        assert.strictEqual(sends[0].params[1][0].address, 'payout-address');
    },
    'legacy-wallet': function() {
        var sends = unshield(1, 0.0004, null, true);
        assert.strictEqual(sends.length, 1);
        assert.strictEqual(sends[0].params[1][0].amount, 0.9999,
            'a coin without an unshieldFee must retain the legacy reserve');
        assert.strictEqual(sends[0].params.length, 2,
            'unconfigured wallets must retain the original two-argument RPC defaults');
    },
    'fee-only': function() {
        var sends = unshield(1, 0.0004, null);
        assert.deepStrictEqual(sends[0].params.slice(2), [7, 0.00015],
            'an explicit transfer fee must opt in without a privacy policy');
    },
    'privacy-only': function() {
        var sends = unshield(1, 0.0004, 'AllowRevealedRecipients', true);
        assert.deepStrictEqual(sends[0].params.slice(2), [7, 0.0001, 'AllowRevealedRecipients'],
            'an explicit privacy policy must opt in with the default transfer reserve');
    },
    'single-block': function() {
        var wallet = processor(6.25, 0, 0.0004, true);
        wallet.shieldTick();
        wallet.poll();
        wallet.shieldTick();
        wallet.poll();
        wallet.pay();
        var sends = wallet.calls('sendmany');
        assert.strictEqual(sends.length, 1, 'one pool reward must pay without any other wallet funds');
        assert.deepStrictEqual(sends[0].params, ['', {tm12345678901234567890123456789012345: 6.2496}]);
        assert.deepStrictEqual(wallet.balances, {coinbase: 0, shielded: 0, payout: 0});
        assert.strictEqual(wallet.fees(), 40000, 'all three transaction fees fit the per-block reserve');
        var record = wallet.redisCommands.reduce(function(commands, batch) {
            return commands.concat(batch);
        }, []).filter(function(command) {
            return command[0] === 'zadd' && command[1] === 'zcash:payments';
        });
        assert.strictEqual(record.length, 1);
        assert.deepStrictEqual(JSON.parse(record[0][3]).blocks, [1]);
        assert.strictEqual(JSON.parse(record[0][3]).paid, 6.2496);
    }
};

var selected = process.argv[2] ? [process.argv[2]] : Object.keys(tests);
selected.forEach(function(name) {
    assert(Object.prototype.hasOwnProperty.call(tests, name), 'Unknown test: ' + name);
    tests[name]();
    console.log('ok - ' + name);
});